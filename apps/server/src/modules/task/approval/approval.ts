import { BaseEntity, DomainEvent, RuleViolation, TableEntity } from '../../platform';
import type { Agent } from '../agent/agent';
import type { GoalRun } from '../goal-run/goal-run';
import { Task } from '../task/task';
import type { ApprovalNew, ApprovalRow } from '../task.tables';
import { ApprovalRequestedView, ApprovalView } from './approval.view';

// 결재 하나. 위험한 동작을 대상·판 번호와 함께 저장만 하고, 주인이 승인한 뒤에 다른 모듈이 실행한다.
//   pending → approved · rejected · revision_requested · cancelled
// 상태는 아래 메서드로만 바꾼다. 결정은 한 번뿐이다.
// 결과 결재 (2차 2단계): 대화의 일에서 올라온 결재는 도중에 따로 정하지 않고(chat_id) 결과 카드(동작 task.chat.result,
// 대상 chat)에 실려(card_id) 카드에서 한꺼번에 정한다. 사람이 바로 해야 하는 동작(IMMEDIATE)은 싣지 않는다
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
  /** 서버가 올리는 동작: 목표 실행의 중간 결재 (승인하면 다음 회차) · 최종 결재 (승인하면 완료) */
  static readonly GOAL_CONTINUE = 'task.goal.continue';
  static readonly GOAL_COMPLETE = 'task.goal.complete';
  static readonly GOAL_RUN = 'goal_run';
  /** 서버가 올리는 동작: 대화 한 회차의 결과 카드 (대상은 대화, 판은 회차) */
  static readonly CARD = 'task.chat.result';
  static readonly CHAT = 'chat';
  /** 대화의 일이어도 카드에 싣지 않고 바로 알리는 동작: 사람이 해야 일이 이어진다 (한도 · 사이트 로그인) */
  static readonly IMMEDIATE: readonly string[] = [Approval.RAISE_LIMIT, 'browser.site.login'];
  private static readonly NOTE_MAX = 4000;

  /**
   * 에이전트가 올린다. 작업은 결재를 기다린다. 요청자·작업은 작업 토큰에서 나온다.
   * chatId: 작업이 대화의 일이면 그 대화 (결과 카드에 실린다. IMMEDIATE 동작은 빼고)
   */
  static request(
    task: Task,
    agent: Agent,
    fields: Pick<ApprovalRow, 'action' | 'target_kind' | 'target_id' | 'target_version' | 'note'>,
    now: Date,
    chatId: string | null = null,
  ): Approval {
    const { action, note } = fields;
    agent.assertMayRequest(action);
    const approval = Approval.pending(
      {
        ...fields,
        space_id: task.spaceId,
        task_id: task.id,
        agent_id: agent.id,
        note: Approval.cleanNote(note),
        chat_id: Approval.IMMEDIATE.includes(action) ? null : chatId,
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

  /**
   * 목표 실행의 결재 (서버가 올린다): 중간(task.goal.continue) · 최종(task.goal.complete).
   * 작업에 묶이지 않는다 (회차 작업은 이미 끝났다). 대상은 실행이고, 결정은 task 모듈의 GoalRunService가 받는다
   */
  static forGoalRun(run: GoalRun, action: string, note: string, now: Date): Approval {
    const approval = Approval.pending(
      {
        space_id: run.spaceId,
        task_id: null,
        agent_id: run.agentId,
        action,
        target_kind: Approval.GOAL_RUN,
        target_id: run.id,
        target_version: run.version,
        note: Approval.cleanNote(note),
      },
      now,
    );
    approval.announce('task.approval.requested');
    return approval;
  }

  /** 대화 한 회차의 결과 카드 (서버가 올린다). 작업에 묶이지 않고, 실린 결재 · 결과물은 card_id로 가리킨다 */
  static forChat(
    spaceId: string,
    chatId: string,
    agentId: string,
    turn: number,
    now: Date,
  ): Approval {
    const card = Approval.pending(
      {
        space_id: spaceId,
        task_id: null,
        agent_id: agentId,
        action: Approval.CARD,
        target_kind: Approval.CHAT,
        target_id: chatId,
        target_version: turn,
        note: null,
      },
      now,
    );
    card.announce('task.approval.requested');
    return card;
  }

  static restore(row: ApprovalRow): Approval {
    return new Approval(row);
  }

  /** 아직 아무도 정하지 않은 결재 */
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

  get targetKind(): string {
    return this.row.target_kind;
  }

  get action(): string {
    return this.row.action;
  }

  get status(): string {
    return this.row.status;
  }

  /** 주인이 정하며 남긴 말 (고쳐 달라면 고칠 내용) */
  get note(): string | null {
    return this.row.note;
  }

  get isCard(): boolean {
    return this.row.action === Approval.CARD;
  }

  /** 대화의 일에서 올라와 결과 카드에서 정할 결재 */
  get bundled(): boolean {
    return this.row.chat_id !== null;
  }

  /** 이 결재를 카드에 싣는다 (기다리는 것만, 한 번만) */
  bundleInto(card: Approval): void {
    if (!this.bundled || !card.isCard) throw new RuleViolation('카드에 실을 결재가 아니에요');
    this.assertPending();
    if (this.row.card_id !== null) throw new RuleViolation('이미 카드에 실린 결재예요');
    this.put('card_id', card.id);
  }

  /**
   * 카드에 새 항목이 실렸다: 대상 판을 지금 회차로 적는다. 저장하면 version도 올라 앞서 본 카드로는 정하지 못한다
   * (같은 회차여도 적는다: 판을 올리는 것이 목적이다)
   */
  grew(turn: number): void {
    this.assertPending();
    this.put('target_version', turn);
  }

  /** 하나씩 정해도 되는 결재인가 (카드에 실리는 결재는 카드에서) */
  assertOwnDecision(): void {
    if (this.bundled) throw new RuleViolation('대화의 결재예요. 결과 카드에서 정해요');
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
        chatId: r.chat_id,
      }),
    );
  }

  private static cleanNote(note: string | null): string | null {
    if (note !== null && note.length > Approval.NOTE_MAX)
      throw new RuleViolation(`메모는 ${Approval.NOTE_MAX}자까지예요`);
    return note;
  }
}
