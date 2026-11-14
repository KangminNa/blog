import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, ChangeStream, Database, Forbidden, NotFound } from '../../platform';
import { Approval } from '../approval/approval';
import { Task } from '../task/task';
import type { ChatRow } from '../task.tables';
import { Chat } from './chat';
import type { AgentReplyInput, ChatIdInput } from './chat.input';
import {
  type ChatApprovalRow,
  ChatDetailView,
  type ChatListRow,
  ChatListView,
  type ChatOutputRow,
  type ChatPartnerRow,
  ChatReplyView,
  type ChatTurnTaskRow,
  ChatTurnView,
} from './chat.view';

// 대화 읽기 (관리자만). 회차는 작업이라 그 대화의 회차 request_id로 작업을 찾는다.
// 결과물 · 기다리는 결재는 회차 작업과 그 아래 하위 작업(위임) 모두에서 모은다: 팀장에게 말하면 팀이 일한다.
@Injectable()
export class ChatQuery extends BaseQuery {
  private static readonly PAGE = 100;
  /** 상세에 싣는 최근 회차 수 */
  private static readonly TURNS = 100;
  /** agent_reply가 기다리는 동안 다시 읽는 신호 (회차 작업 · 결재 · 진행 기록) */
  private static readonly WATCH: readonly string[] = [
    'task.task.changed',
    'task.event.added',
    'task.approval.requested',
  ];
  /** 신호를 놓쳐도 이만큼마다 다시 읽는다 */
  private static readonly RECHECK_MS = 5_000;

  constructor(
    db: Database,
    private readonly changes: ChangeStream,
  ) {
    super(db);
  }

  async list(actor: Actor): Promise<ChatListView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const rows = await this.sql<(ChatRow & { agent_name: string })[]>`
      SELECT c.*, a.name AS agent_name FROM task.chats c
      JOIN task.agents a ON a.id = c.agent_id
      WHERE c.space_id = ${spaceId}
      ORDER BY c.updated_at DESC, c.id DESC LIMIT ${ChatQuery.PAGE}`;
    const last = rows.filter((r) => r.turns > 0).map((r) => Chat.turnRequestId(r.id, r.turns));
    const states =
      last.length === 0
        ? []
        : await this.sql<Pick<ChatTurnTaskRow, 'request_id' | 'status' | 'wait_reason'>[]>`
          SELECT request_id, status, wait_reason FROM task.tasks
          WHERE space_id = ${spaceId} AND request_id = ANY(${last}::text[])`;
    const listed: ChatListRow[] = rows.map((r) => {
      const state = states.find((s) => s.request_id === Chat.turnRequestId(r.id, r.turns));
      return {
        ...r,
        last_status: state?.status ?? null,
        last_wait_reason: state?.wait_reason ?? null,
      };
    });
    return new ChatListView(listed);
  }

  async get(actor: Actor, req: ChatIdInput): Promise<ChatDetailView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const [chat] = await this.sql<ChatRow[]>`
      SELECT * FROM task.chats WHERE space_id = ${spaceId} AND id = ${req.id}`;
    if (!chat) throw new NotFound('대화를 찾을 수 없어요');
    const [partner] = await this.sql<ChatPartnerRow[]>`
      SELECT name, status, reports_to, deleted_at FROM task.agents WHERE id = ${chat.agent_id}`;
    const ids = Chat.turnRequestIds(chat.id, chat.turns - ChatQuery.TURNS + 1, chat.turns);
    const turns = await this.turns(spaceId, ids);
    return new ChatDetailView(chat, partner as ChatPartnerRow, await this.views(turns));
  }

  /**
   * MCP agent_reply: 기기가 연 대화의 마지막 회차. 답이 오거나(끝남 · 실패 · 멈춤) 관리자의 결재를 기다리게 되면 바로,
   * 아니면 waitSeconds까지 신호를 기다렸다가 돌려준다 (트랜잭션 밖). 다른 기기 · 관리자의 대화는 없는 것처럼 (404)
   */
  async reply(actor: Actor, req: AgentReplyInput): Promise<ChatReplyView> {
    actor.assertCan(Actor.DELEGATE);
    if (actor.kind !== 'device' || !actor.id) throw new Forbidden(Actor.DELEGATE);
    const spaceId = actor.requireSpace();
    const deadline = Date.now() + req.waitSeconds * 1000;
    for (;;) {
      const [chat] = await this.sql<ChatRow[]>`
        SELECT * FROM task.chats
        WHERE space_id = ${spaceId} AND id = ${req.chatId} AND device_id = ${actor.id}`;
      if (!chat) throw new NotFound('대화를 찾을 수 없어요');
      const [turn] = await this.turns(
        spaceId,
        Chat.turnRequestIds(chat.id, chat.turns, chat.turns),
      );
      const answered =
        !turn || !ChatQuery.OPEN.includes(turn.status) || turn.wait_reason === 'approval';
      const left = deadline - Date.now();
      if (answered || left <= 0 || this.changes.closed) {
        const [view] = turn ? await this.views([turn]) : [];
        return new ChatReplyView(chat, view ?? null, answered);
      }
      await this.changes.wait(
        (signal) => signal.spaceId === spaceId && ChatQuery.WATCH.includes(signal.topic),
        Math.min(left, ChatQuery.RECHECK_MS),
      );
    }
  }

  /** 회차마다 그 아래의 결과물 · 기다리는 결재를 붙인다 */
  private async views(turns: readonly ChatTurnTaskRow[]): Promise<ChatTurnView[]> {
    const roots = turns.map((t) => t.id);
    const [outputs, approvals] = await Promise.all([this.outputs(roots), this.approvals(roots)]);
    return turns.map((t) => new ChatTurnView(t, outputs, approvals));
  }

  private turns(spaceId: string, ids: readonly string[]): Promise<ChatTurnTaskRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.sql<ChatTurnTaskRow[]>`
      SELECT t.*,
        (SELECT e.body FROM task.task_events e
          WHERE e.task_id = t.id AND e.body <> '' ORDER BY e.id DESC LIMIT 1) AS last_event,
        (SELECT count(*)::int FROM task.tasks c
          WHERE c.parent_id = t.id AND c.status = ANY(${ChatQuery.OPEN}::text[])) AS open_subtasks
      FROM task.tasks t
      WHERE t.space_id = ${spaceId} AND t.request_id = ANY(${ids as string[]}::text[])
      ORDER BY t.created_at, t.id`;
  }

  /** 회차마다 그 아래(하위 작업 포함)에서 만든 결과물 (휴지통 제외) */
  private outputs(roots: readonly string[]): Promise<ChatOutputRow[]> {
    if (roots.length === 0) return Promise.resolve([]);
    return this.sql<ChatOutputRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id, id AS root FROM task.tasks WHERE id = ANY(${roots as string[]}::uuid[])
        UNION ALL
        SELECT c.id, tree.root FROM task.tasks c JOIN tree ON c.parent_id = tree.id)
      SELECT tree.root, o.id, o.name, o.kind FROM tree
      JOIN task.outputs o ON o.task_id = tree.id AND o.deleted_at IS NULL
      ORDER BY o.id`;
  }

  /** 회차마다 그 아래(하위 작업 포함)에서 기다리는 결재: 대화 안에서 바로 결정한다 */
  private approvals(roots: readonly string[]): Promise<ChatApprovalRow[]> {
    if (roots.length === 0) return Promise.resolve([]);
    return this.sql<ChatApprovalRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id, id AS root FROM task.tasks WHERE id = ANY(${roots as string[]}::uuid[])
        UNION ALL
        SELECT c.id, tree.root FROM task.tasks c JOIN tree ON c.parent_id = tree.id)
      SELECT tree.root, a.id FROM tree
      JOIN task.approvals a ON a.task_id = tree.id AND a.status = ${Approval.PENDING}
      ORDER BY a.id`;
  }

  private static readonly OPEN: readonly string[] = [Task.QUEUED, Task.RUNNING, Task.WAITING];
}
