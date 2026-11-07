import { BaseEntity, Conflict, DomainEvent, NotFound, TableEntity } from '../../platform';
import type { ChangeOpRow, ChangeSetNew, ChangeSetRow } from '../vault.tables';
import { ChangeSetView, SubmittedChangesView } from './change.view';
import type { ChangeOp, RevertOp } from './change-op';
import { type ChangeTarget, ChangeWork } from './change-target';

/** change_sets 한 줄 + 그 안의 변경들 (번호 순). JSON으로 함께 읽는다 */
export interface LoadedChangeSet extends ChangeSetRow {
  ops: readonly ChangeOpRow[] | null;
}

// 변경 묶음: git의 커밋 하나. AI가 결과를 한 번 낼 때마다, 관리 화면에서 고칠 때마다, 되돌릴 때마다 하나.
// 안의 변경(ChangeOp)이 모두 끝나면 done, 검토를 기다리는 변경이 있으면 review. 상태는 판정·결정이 끝날 때 묶음이 정한다.
export class ChangeSet extends TableEntity<LoadedChangeSet, ChangeSetNew> {
  static readonly TIDY = 'tidy';
  static readonly HUMAN = 'human';
  static readonly REVERT = 'revert';
  static readonly REVIEW = 'review';
  static readonly DONE = 'done';
  private static readonly MESSAGE_MAX = 2_000;

  /** 이번 요청에서 연 묶음인가. 머리를 먼저 저장해도(begin) 요청이 끝날 때까지 그대로다 */
  readonly opened: boolean;

  private constructor(
    row: LoadedChangeSet | ChangeSetNew,
    readonly ops: readonly ChangeOp[],
    fresh: boolean,
  ) {
    super(row, fresh);
    this.opened = fresh;
  }

  static open(
    spaceId: string,
    kind: string,
    actorType: string,
    actorId: string | null,
    /** 작업 토큰으로 낸 묶음의 작업 id. 작업 하나에 묶음 하나 */
    jobId: string | null,
    message: string,
    ops: readonly ChangeOp[],
    now: Date,
  ): ChangeSet {
    return new ChangeSet(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        kind,
        status: ChangeSet.REVIEW,
        actor_type: actorType,
        actor_id: actorId,
        job_id: jobId,
        message: message.slice(0, ChangeSet.MESSAGE_MAX),
        op_count: ops.length,
        created_at: now,
        submitted_at: now,
      },
      ops,
      true,
    );
  }

  /** ops: 저장소가 행에서 되살린 변경들 */
  static restore(row: LoadedChangeSet, ops: readonly ChangeOp[]): ChangeSet {
    return new ChangeSet(row, ops, false);
  }

  /** 묶음의 종류 · 상태 · 낸 쪽. 편집을 부른 쪽이 결과로 확인한다 */
  get kind(): string {
    return this.row.kind;
  }

  get status(): string {
    return this.row.status;
  }

  get actorType(): string {
    return this.row.actor_type;
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
    const { space_id, actor_type, actor_id } = this.row;
    return new ChangeWork(space_id, this.id, actor_type, actor_id, now, approved);
  }

  /** 판정·적용이 끝났다. 검토를 기다리는 변경이 없으면 닫는다 */
  submitted(now: Date): void {
    this.settle(now);
    this.announce('vault.change.submitted', { kind: this.row.kind, status: this.row.status });
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
    this.announce('vault.change.decided', { seq: op.seq, status: op.status });
  }

  /** 한 번 되돌린 묶음은 다시 되돌리지 않는다 (되돌린 묶음을 되돌리면 다시 적용된다) */
  assertRevertible(): void {
    if (this.row.reverted_by !== null) throw new Conflict('이미 되돌린 변경 묶음이에요');
  }

  /** 되돌렸다. 기록은 지우지 않고, 기다리던 변경은 밀려난다 */
  revertedWith(revertId: string, by: string | null, now: Date): void {
    this.put('reverted_by', revertId);
    for (const op of this.ops) if (op.waiting) op.supersede(by, now, '변경 묶음을 되돌렸어요');
    this.settle(now);
    this.announce('vault.change.reverted', { revertId });
  }

  /** 되돌리는 묶음을 새로 연다 */
  static reverting(
    original: ChangeSet,
    actorId: string | null,
    ops: readonly RevertOp[],
    now: Date,
  ): ChangeSet {
    const { space_id, message } = original.row;
    return ChangeSet.open(
      space_id,
      ChangeSet.REVERT,
      'user',
      actorId,
      null,
      `되돌리기: ${message}`,
      ops,
      now,
    );
  }

  /** 변경 묶음 하나의 결과. 화면은 이 version으로 다음 결정을 보낸다 */
  view(): ChangeSetView {
    return new ChangeSetView(this.row, this.opRows);
  }

  /** submit_changes의 답 */
  submittedView(): SubmittedChangesView {
    return new SubmittedChangesView(this.id, this.opRows);
  }

  private get opRows(): readonly ChangeOpRow[] {
    return this.ops.map((op) => op.toRow(this.id));
  }

  private settle(now: Date): void {
    const status = this.ops.some((op) => op.waiting) ? ChangeSet.REVIEW : ChangeSet.DONE;
    if (status === this.row.status) return;
    this.put('status', status);
    if (status === ChangeSet.DONE) this.put('closed_at', now);
  }

  private announce(topic: string, data: Readonly<Record<string, unknown>>): void {
    this.record(new DomainEvent(topic, 1, this.row.space_id, { changeSetId: this.id, ...data }));
  }
}
