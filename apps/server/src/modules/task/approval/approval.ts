import { BaseEntity, DomainEvent, RuleViolation, TableEntity } from '../../platform';
import type { Agent } from '../agent/agent';
import { Task } from '../task/task';
import type { ApprovalNew, ApprovalRow } from '../task.tables';
import { ApprovalRequestedView, ApprovalView } from './approval.view';

// 결재 하나. 위험한 동작을 대상·판 번호와 함께 저장만 하고, 주인이 승인한 뒤에 다른 모듈이 실행한다.
//   pending → approved · rejected · revision_requested · cancelled
// 상태는 아래 메서드로만 바꾼다. 결정은 한 번뿐이다.
export class Approval extends TableEntity<ApprovalRow, ApprovalNew> {
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

  /** 에이전트가 올린다. 작업은 결재를 기다린다 */
  static request(
    task: Task,
    agent: Agent,
    fields: Omit<ApprovalNew, 'id' | 'space_id'>,
    now: Date,
  ): Approval {
    const { action, note = null } = fields;
    agent.assertMayRequest(action);
    const approval = Approval.pending(
      {
        ...fields,
        space_id: task.spaceId,
        task_id: task.id,
        agent_id: agent.id,
        note: Approval.cleanNote(note),
      },
      now,
    );
    task.waitFor(now);
    // 주인이 결정하며 남기는 말이 note를 덮으므로, 에이전트의 말은 실행 기록에 남긴다 (원칙 2)
    task.log(Task.LOG_WRITE, `결재 요청: ${action}${note ? ` (${note})` : ''}`, 0, now);
    approval.announce('task.approval.requested');
    return approval;
  }

  /** 에이전트가 한 달 한도를 넘겼다. 작업에 묶이지 않는 결재라 대상은 에이전트 자신이다 */
  static raiseLimit(agent: Agent, usedThisMonth: number, now: Date): Approval {
    const approval = Approval.pending(
      {
        space_id: agent.spaceId,
        task_id: null,
        agent_id: agent.id,
        action: Approval.RAISE_LIMIT,
        target_kind: 'agent',
        target_id: agent.id,
        target_version: agent.version,
        note: `이번 달 ${usedThisMonth} 토큰 사용, 한도 ${agent.monthlyLimit}`,
      },
      now,
    );
    approval.announce('task.approval.requested');
    return approval;
  }

  static restore(row: ApprovalRow): Approval {
    return new Approval(row);
  }

  private static pending(fields: Omit<ApprovalNew, 'id'>, now: Date): Approval {
    return new Approval(
      {
        ...fields,
        id: BaseEntity.newId(),
        status: Approval.PENDING,
        decided_by: null,
        created_at: now,
      },
      true,
    );
  }

  get taskId(): string | null {
    return this.row.task_id;
  }

  get targetId(): string {
    return this.row.target_id;
  }

  get approved(): boolean {
    return this.row.status === Approval.APPROVED;
  }

  /** 승인한 한도 올리기인가 (task 모듈 안의 일이라 이벤트를 기다리지 않고 같은 트랜잭션에서 한다) */
  get raisesLimit(): boolean {
    return this.approved && this.row.action === Approval.RAISE_LIMIT;
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
    this.put('status', Approval.CANCELLED);
    this.announce('task.approval.cancelled');
  }

  /** 결정을 작업에 옮긴다: 승인이면 실행을 기다리고, 고칠 일이면 에이전트에게 돌아가고, 거절이면 멈춘다 */
  applyTo(task: Task, now: Date): void {
    const r = this.row;
    if (r.status === Approval.APPROVED) task.resume();
    else if (r.status === Approval.REVISION_REQUESTED)
      task.returnForRevision(r.note, r.target_kind, r.target_id, r.target_version);
    else if (r.status === Approval.REJECTED) task.cancel(now);
  }

  view(): ApprovalView {
    return new ApprovalView(this.row);
  }

  requestedView(): ApprovalRequestedView {
    return new ApprovalRequestedView(this.row);
  }

  private close(status: string, deciderId: string, note: string | null, now: Date): void {
    this.assertPending();
    this.put('status', status);
    this.put('decided_by', deciderId);
    this.put('decided_at', now);
    if (note !== null) this.put('note', Approval.cleanNote(note));
  }

  private assertPending(): void {
    if (this.row.status !== Approval.PENDING)
      throw new RuleViolation(`이미 끝난 결재예요 (${this.row.status})`);
  }

  private announce(topic: string): void {
    const r = this.row;
    this.record(
      new DomainEvent(topic, 1, r.space_id, {
        approvalId: this.id,
        taskId: r.task_id,
        agentId: r.agent_id,
        action: r.action,
        targetKind: r.target_kind,
        targetId: r.target_id,
        targetVersion: r.target_version,
        decidedBy: r.decided_by,
        note: r.note,
      }),
    );
  }

  private static cleanNote(note: string | null): string | null {
    if (note !== null && note.length > Approval.NOTE_MAX)
      throw new RuleViolation(`메모는 ${Approval.NOTE_MAX}자까지예요`);
    return note;
  }
}
