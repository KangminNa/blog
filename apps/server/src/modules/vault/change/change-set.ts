import { BaseEntity, Conflict, DomainEvent, NotFound, TrackedEntity } from '../../platform';
import type { ChangeOp, RevertOp } from './change-op';
import { type ChangeTarget, ChangeWork } from './change-target';

// 변경 묶음: git의 커밋 하나. AI가 결과를 한 번 낼 때마다, 관리 화면에서 고칠 때마다, 되돌릴 때마다 하나.
// 안의 변경(ChangeOp)이 모두 끝나면 done, 검토를 기다리는 변경이 있으면 review.
export class ChangeSet extends TrackedEntity {
  static readonly TIDY = 'tidy';
  static readonly HUMAN = 'human';
  static readonly REVERT = 'revert';
  static readonly REVIEW = 'review';
  static readonly DONE = 'done';
  private static readonly MESSAGE_MAX = 2_000;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly kind: string,
    private statusValue: string,
    readonly actorType: string,
    readonly actorId: string | null,
    /** 작업 토큰으로 낸 묶음의 작업 id. 작업 하나에 묶음 하나 */
    readonly jobId: string | null,
    readonly message: string,
    readonly ops: readonly ChangeOp[],
    private revertedByValue: string | null,
    readonly createdAt: Date,
    private closedAtValue: Date | null,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  static open(
    spaceId: string,
    kind: string,
    actorType: string,
    actorId: string | null,
    jobId: string | null,
    message: string,
    ops: readonly ChangeOp[],
    now: Date,
  ): ChangeSet {
    return new ChangeSet(
      BaseEntity.newId(),
      1,
      spaceId,
      kind,
      ChangeSet.REVIEW,
      actorType,
      actorId,
      jobId,
      message.slice(0, ChangeSet.MESSAGE_MAX),
      ops,
      null,
      now,
      null,
      true,
    );
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    kind: string,
    status: string,
    actorType: string,
    actorId: string | null,
    jobId: string | null,
    message: string,
    ops: readonly ChangeOp[],
    revertedBy: string | null,
    createdAt: Date,
    closedAt: Date | null,
  ): ChangeSet {
    return new ChangeSet(
      id,
      version,
      spaceId,
      kind,
      status,
      actorType,
      actorId,
      jobId,
      message,
      ops,
      revertedBy,
      createdAt,
      closedAt,
      false,
    );
  }

  get status(): string {
    return this.statusValue;
  }

  get revertedBy(): string | null {
    return this.revertedByValue;
  }

  get closedAt(): Date | null {
    return this.closedAtValue;
  }

  /** 건드리는 대상 수: 같은 대상을 고치는 변경은 하나로, 새로 만드는 변경은 각각 하나로 센다 */
  get targetCount(): number {
    return new Set(this.ops.map((op) => op.targetId ?? `new:${op.seq}`)).size;
  }

  /** 첫 변경의 대상 (관리 화면 편집의 결과) */
  get result(): ChangeTarget | null {
    return this.ops[0]?.target ?? null;
  }

  /** 변경을 적용할 맥락. approved: 사람이 승인해서 적용한다 */
  work(now: Date, approved = false): ChangeWork {
    return new ChangeWork(this.spaceId, this.id, this.actorType, this.actorId, now, approved);
  }

  /** 판정·적용이 끝났다. 검토를 기다리는 변경이 없으면 닫는다 */
  submitted(now: Date): void {
    this.settle(now);
    this.record(
      new DomainEvent('vault.change.submitted', 1, this.spaceId, {
        changeSetId: this.id,
        kind: this.kind,
        status: this.statusValue,
      }),
    );
  }

  /** 검토를 기다리는 변경 하나. 이미 끝났으면 Conflict */
  waitingOp(seq: number): ChangeOp {
    const op = this.ops.find((o) => o.seq === seq);
    if (!op) throw new NotFound(`${seq}번 변경이 없어요`);
    if (!op.waiting) throw new Conflict('이미 처리한 변경이에요');
    return op;
  }

  /** 검토 하나가 끝났다 */
  decided(op: ChangeOp, now: Date): void {
    this.settle(now);
    this.record(
      new DomainEvent('vault.change.decided', 1, this.spaceId, {
        changeSetId: this.id,
        seq: op.seq,
        status: op.status,
      }),
    );
  }

  /** 한 번 되돌린 묶음은 다시 되돌리지 않는다 (되돌린 묶음을 되돌리면 다시 적용된다) */
  assertRevertible(): void {
    if (this.revertedByValue !== null) throw new Conflict('이미 되돌린 변경 묶음이에요');
  }

  /** 되돌렸다. 기록은 지우지 않고, 기다리던 변경은 밀려난다 */
  revertedWith(revertId: string, by: string | null, now: Date): void {
    this.revertedByValue = revertId;
    this.track('reverted_by', revertId);
    for (const op of this.ops) if (op.waiting) op.supersede(by, now, '변경 묶음을 되돌렸어요');
    this.settle(now);
    this.record(
      new DomainEvent('vault.change.reverted', 1, this.spaceId, {
        changeSetId: this.id,
        revertId,
      }),
    );
  }

  /** 되돌리는 묶음을 새로 연다 */
  static reverting(
    original: ChangeSet,
    actorId: string | null,
    ops: readonly RevertOp[],
    now: Date,
  ): ChangeSet {
    return ChangeSet.open(
      original.spaceId,
      ChangeSet.REVERT,
      'user',
      actorId,
      null,
      `되돌리기: ${original.message}`,
      ops,
      now,
    );
  }

  private settle(now: Date): void {
    const status = this.ops.some((op) => op.waiting) ? ChangeSet.REVIEW : ChangeSet.DONE;
    if (status === this.statusValue) return;
    this.statusValue = status;
    this.track('status', status);
    if (status === ChangeSet.DONE) {
      this.closedAtValue = now;
      this.track('closed_at', now);
    }
  }
}
