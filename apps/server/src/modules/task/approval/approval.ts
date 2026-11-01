import { BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import type { Agent } from '../agent/agent';
import { type Task, TaskLogEntry } from '../task/task';
import { TrackedEntity } from '../tracked-entity';

// 결재 하나. 위험한 동작을 대상·판 번호와 함께 저장만 하고, 주인이 승인한 뒤에 다른 모듈이 실행한다.
//   pending → approved · rejected · revision_requested · cancelled
// 상태는 아래 메서드로만 바꾼다. 결정은 한 번뿐이다.
export class Approval extends TrackedEntity {
  static readonly PENDING = 'pending';
  static readonly APPROVED = 'approved';
  static readonly REJECTED = 'rejected';
  static readonly REVISION_REQUESTED = 'revision_requested';
  static readonly CANCELLED = 'cancelled';
  static readonly APPROVE = 'approve';
  static readonly REVISE = 'revise';
  static readonly REJECT = 'reject';
  static readonly DECISIONS: readonly string[] = [
    Approval.APPROVE,
    Approval.REVISE,
    Approval.REJECT,
  ];
  /** 서버가 올리는 동작: 에이전트가 한 달 한도를 넘겼다 */
  static readonly RAISE_LIMIT = 'task.agent.raise_limit';
  private static readonly NOTE_MAX = 4000;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly taskId: string | null,
    readonly agentId: string | null,
    readonly action: string,
    readonly targetKind: string,
    readonly targetId: string,
    readonly targetVersion: number,
    private statusValue: string,
    private decider: string | null,
    private decidedOn: Date | null,
    private noteValue: string | null,
    readonly createdAt: Date,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  /** 에이전트가 올린다. 작업은 결재를 기다린다 */
  static request(
    task: Task,
    agent: Agent,
    action: string,
    targetKind: string,
    targetId: string,
    targetVersion: number,
    note: string | null,
    now: Date,
  ): Approval {
    agent.assertMayRequest(action);
    const approval = new Approval(
      BaseEntity.newId(),
      1,
      task.spaceId,
      task.id,
      agent.id,
      action,
      targetKind,
      targetId,
      targetVersion,
      Approval.PENDING,
      null,
      null,
      Approval.cleanNote(note),
      now,
      true,
    );
    task.waitFor(now);
    // 주인이 결정하며 남기는 말이 note를 덮으므로, 에이전트의 말은 실행 기록에 남긴다 (원칙 2)
    task.log(TaskLogEntry.WRITE, `결재 요청: ${action}${note ? ` (${note})` : ''}`, 0, now);
    approval.announce('task.approval.requested');
    return approval;
  }

  /** 에이전트가 한 달 한도를 넘겼다. 작업에 묶이지 않는 결재라 대상은 에이전트 자신이다 */
  static raiseLimit(agent: Agent, usedThisMonth: number, now: Date): Approval {
    const approval = new Approval(
      BaseEntity.newId(),
      1,
      agent.spaceId,
      null,
      agent.id,
      Approval.RAISE_LIMIT,
      'agent',
      agent.id,
      agent.version,
      Approval.PENDING,
      null,
      null,
      `이번 달 ${usedThisMonth} 토큰 사용, 한도 ${agent.monthlyLimit}`,
      now,
      true,
    );
    approval.announce('task.approval.requested');
    return approval;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    taskId: string | null,
    agentId: string | null,
    action: string,
    targetKind: string,
    targetId: string,
    targetVersion: number,
    status: string,
    decidedBy: string | null,
    decidedAt: Date | null,
    note: string | null,
    createdAt: Date,
  ): Approval {
    return new Approval(
      id,
      version,
      spaceId,
      taskId,
      agentId,
      action,
      targetKind,
      targetId,
      targetVersion,
      status,
      decidedBy,
      decidedAt,
      note,
      createdAt,
      false,
    );
  }

  get status(): string {
    return this.statusValue;
  }

  get decidedBy(): string | null {
    return this.decider;
  }

  get decidedAt(): Date | null {
    return this.decidedOn;
  }

  get note(): string | null {
    return this.noteValue;
  }

  get approved(): boolean {
    return this.statusValue === Approval.APPROVED;
  }

  /** 승인한 한도 올리기인가 (task 모듈 안의 일이라 이벤트를 기다리지 않고 같은 트랜잭션에서 한다) */
  get raisesLimit(): boolean {
    return this.approved && this.action === Approval.RAISE_LIMIT;
  }

  /** 주인의 결정 하나 */
  decide(decision: string, deciderId: string, note: string | null, now: Date): void {
    if (decision === Approval.APPROVE) this.approve(deciderId, note, now);
    else if (decision === Approval.REVISE) this.requestRevision(deciderId, note, now);
    else if (decision === Approval.REJECT) this.reject(deciderId, note, now);
    else throw new RuleViolation(`결정은 ${Approval.DECISIONS.join(' · ')} 중 하나예요`);
  }

  /** 승인: 대상을 가진 모듈이 이 이벤트를 받아 실행한다 */
  approve(deciderId: string, note: string | null, now: Date): void {
    this.close(Approval.APPROVED, deciderId, note, now);
    this.announce('task.approval.granted');
  }

  reject(deciderId: string, note: string | null, now: Date): void {
    this.close(Approval.REJECTED, deciderId, note, now);
    this.announce('task.approval.rejected');
  }

  /** 고쳐 달라고 한다. 고칠 말이 없으면 에이전트가 무엇을 고칠지 알 수 없다 */
  requestRevision(deciderId: string, note: string | null, now: Date): void {
    if (!note?.trim()) throw new RuleViolation('고칠 내용을 적어 주세요');
    this.close(Approval.REVISION_REQUESTED, deciderId, note, now);
    this.announce('task.approval.revision_requested');
  }

  /** 작업이 취소되면 기다리던 결재도 닫는다 */
  cancel(): void {
    this.assertPending();
    this.moveTo(Approval.CANCELLED);
    this.announce('task.approval.cancelled');
  }

  /** 결정을 작업에 옮긴다: 승인이면 실행을 기다리고, 고칠 일이면 에이전트에게 돌아가고, 거절이면 멈춘다 */
  applyTo(task: Task, now: Date): void {
    if (this.statusValue === Approval.APPROVED) task.resume();
    else if (this.statusValue === Approval.REVISION_REQUESTED) task.returnForRevision(this.note);
    else if (this.statusValue === Approval.REJECTED) task.cancel(now);
  }

  private close(status: string, deciderId: string, note: string | null, now: Date): void {
    this.assertPending();
    this.moveTo(status);
    this.decider = deciderId;
    this.track('decided_by', deciderId);
    this.decidedOn = now;
    this.track('decided_at', now);
    if (note !== null) {
      this.noteValue = Approval.cleanNote(note);
      this.track('note', this.noteValue);
    }
  }

  private assertPending(): void {
    if (this.statusValue !== Approval.PENDING)
      throw new RuleViolation(`이미 끝난 결재예요 (${this.statusValue})`);
  }

  private moveTo(status: string): void {
    this.statusValue = status;
    this.track('status', status);
  }

  private announce(topic: string): void {
    this.record(
      new DomainEvent(topic, 1, this.spaceId, {
        approvalId: this.id,
        taskId: this.taskId,
        agentId: this.agentId,
        action: this.action,
        targetKind: this.targetKind,
        targetId: this.targetId,
        targetVersion: this.targetVersion,
        decidedBy: this.decider,
        note: this.noteValue,
      }),
    );
  }

  private static cleanNote(note: string | null): string | null {
    if (note !== null && note.length > Approval.NOTE_MAX)
      throw new RuleViolation(`메모는 ${Approval.NOTE_MAX}자까지예요`);
    return note;
  }
}
