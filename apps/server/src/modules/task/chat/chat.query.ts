import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, NotFound } from '../../platform';
import { Approval } from '../approval/approval';
import { Task } from '../task/task';
import type { ApprovalRow, ChatRow, TaskRow } from '../task.tables';
import type { ChatIdInput } from './chat.input';
import {
  type ChatApprovalRow,
  type ChatCardOutputRow,
  ChatCardView,
  ChatDetailView,
  ChatListView,
  type ChatOutputRow,
  type ChatPartnerRow,
  type ChatTurnTaskRow,
  ChatTurnView,
  type ChatUpdateLine,
} from './chat.view';
import { ChatRequest } from './chat-request.policy';
import { ChatResult } from './chat-result.policy';
import { ChatUpdates } from './chat-update.policy';
import { ChatUpdateQuery } from './chat-update.query';

// 대화 읽기 (관리자만). 회차는 작업이라 그 대화의 회차 request_id로 작업을 찾는다.
// 결과물 · 기다리는 결재는 회차 작업과 그 아래 하위 작업(위임) 모두에서 모은다: 팀장에게 말하면 팀이 일한다.
// 상세에는 상태(ChatUpdateQuery와 같은 규칙) · 최근 소식(과정)을 함께 싣는다 (2차 1-1). 팀은 싣지 않는다: 화면은 대화만 (2차 1-5).
// 맡기 전의 대화는 회차가 없고 첫 메시지(pending)와 지금 질문을 싣는다
@Injectable()
export class ChatQuery extends BaseQuery {
  private static readonly PAGE = 100;
  /** 상세에 싣는 최근 회차 수 */
  private static readonly TURNS = 100;
  /** 상세에 싣는 최근 소식 수 */
  private static readonly NEWS = 50;

  constructor(
    db: Database,
    private readonly updates: ChatUpdateQuery,
  ) {
    super(db);
  }

  /** 대화 목록 (최근 것부터): 맡은 에이전트의 이름과 상태 (상태판과 같은 규칙) */
  async list(actor: Actor): Promise<ChatListView> {
    return new ChatListView(await this.updates.ownerBoard(actor, null, ChatQuery.PAGE));
  }

  async get(actor: Actor, req: ChatIdInput): Promise<ChatDetailView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const [chat] = await this.sql<ChatRow[]>`
      SELECT * FROM task.chats WHERE space_id = ${spaceId} AND id = ${req.id}`;
    if (!chat) throw new NotFound('대화를 찾을 수 없어요');
    const [partner] = await this.sql<ChatPartnerRow[]>`
      SELECT name, status, reports_to, deleted_at FROM task.agents WHERE id = ${chat.agent_id}`;
    const ids = ChatRequest.turns(chat.id, chat.turns - ChatQuery.TURNS + 1, chat.turns);
    const turns = await this.turns(spaceId, ids);
    const [board] = await this.updates.ownerBoard(actor, chat.id);
    const news = await this.news(chat.id);
    const asked = news.filter((n) => n.kind === ChatUpdates.QUESTION).at(-1) ?? null;
    return new ChatDetailView(
      chat,
      partner ?? null,
      await this.views(turns),
      board ?? null,
      news,
      chat.agent_id === null ? asked : null,
      await this.card(chat),
    );
  }

  /** 기다리는 결과 카드: 실린 결재 · 결과물, 받을 것의 검사, 그 회차의 검토 (2차 2단계) */
  private async card(chat: ChatRow): Promise<ChatCardView | null> {
    const [card] = await this.sql<ApprovalRow[]>`
      SELECT * FROM task.approvals
      WHERE action = ${Approval.CARD} AND target_id = ${chat.id} AND status = ${Approval.PENDING}`;
    if (!card) return null;
    const actions = await this.sql<ApprovalRow[]>`
      SELECT * FROM task.approvals
      WHERE card_id = ${card.id} AND status = ${Approval.PENDING} ORDER BY id`;
    const outputs = await this.sql<ChatCardOutputRow[]>`
      SELECT id, name, kind, mime FROM task.outputs
      WHERE card_id = ${card.id} AND deleted_at IS NULL ORDER BY id`;
    const [review] = await this.sql<Pick<TaskRow, 'status' | 'result'>[]>`
      SELECT status, result FROM task.tasks
      WHERE space_id = ${chat.space_id}
        AND request_id = ${ChatRequest.review(chat.id, card.target_version)}`;
    const missing = ChatResult.missing(
      chat.deliver,
      actions.map((a) => a.action),
      outputs.map((o) => o.name),
    );
    const said = review?.status === Task.DONE ? ChatResult.textOf(review.result) : '';
    return new ChatCardView(card, actions, outputs, chat.deliver, missing === null, said || null);
  }

  /** 이 대화의 최근 소식 (오래된 것부터). 질문이면 고를 에이전트들 (맡는 일은 역할의 첫 줄) */
  private news(chatId: string): Promise<ChatUpdateLine[]> {
    return this.sql<ChatUpdateLine[]>`
      SELECT * FROM (
        SELECT u.*, a.name AS agent,
          (SELECT json_agg(json_build_object('id', x.id, 'name', x.name,
              'role', split_part(x.role, E'\n', 1)) ORDER BY c.ord)
            FROM unnest(u.choices) WITH ORDINALITY AS c(id, ord)
            JOIN task.agents x ON x.id = c.id) AS choice_list
        FROM task.chat_updates u
        LEFT JOIN task.agents a ON a.id = u.agent_id
        WHERE u.chat_id = ${chatId} ORDER BY u.n DESC LIMIT ${ChatQuery.NEWS}
      ) recent ORDER BY n`;
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

  /** 회차마다 그 아래(하위 작업 포함)에서 기다리는, 결과 카드에 싣지 않는 결재(바로 알리는 동작): 대화 안에서 바로 결정한다 */
  private approvals(roots: readonly string[]): Promise<ChatApprovalRow[]> {
    if (roots.length === 0) return Promise.resolve([]);
    return this.sql<ChatApprovalRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id, id AS root FROM task.tasks WHERE id = ANY(${roots as string[]}::uuid[])
        UNION ALL
        SELECT c.id, tree.root FROM task.tasks c JOIN tree ON c.parent_id = tree.id)
      SELECT tree.root, a.id FROM tree
      JOIN task.approvals a ON a.task_id = tree.id AND a.status = ${Approval.PENDING}
        AND a.chat_id IS NULL
      ORDER BY a.id`;
  }

  private static readonly OPEN: readonly string[] = [Task.QUEUED, Task.RUNNING, Task.WAITING];
}
