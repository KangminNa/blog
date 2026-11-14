import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, ChangeStream, Database, Forbidden, RuleViolation } from '../../platform';
import { Approval } from '../approval/approval';
import { JobChatView } from '../task/job.view';
import { Task } from '../task/task';
import { AgentUpdatesView, type ChatBoardRow, type ChatUpdateLine } from './chat.view';
import { ChatProject } from './chat-project.policy';
import { ChatRequest } from './chat-request.policy';
import type { AgentUpdatesInput } from './chat-update.input';
import { ChatUpdates } from './chat-update.policy';

// 대화의 소식 읽기 (MCP agent_updates, 2차 1-1). 기기의 권한으로 범위를 정한다:
//   delegate → 그 기기가 연 대화만, news(소식 기기, 훅 · 상태 줄) → 공간의 모든 대화 (읽기만)
// 커서(n)는 커밋 순서와 다를 수 있어서, 아직 끝나지 않은 트랜잭션보다 앞선 줄만 읽는다 (tx < pg_snapshot_xmin): 건너뛰지 않게.
// 새 소식이 없으면 wait_seconds까지 변경 신호를 기다린다 (트랜잭션 밖).
@Injectable()
export class ChatUpdateQuery extends BaseQuery {
  /** 커서 없이 부르면 최근 이만큼부터 */
  private static readonly RECENT = 20;
  private static readonly PAGE = 50;
  private static readonly BOARD = 20;
  /** 일에 실어 보내는 팀 소식 수 */
  private static readonly TEAM = 20;
  /** 신호를 놓쳐도 이만큼마다 다시 읽는다 */
  private static readonly RECHECK_MS = 5_000;
  private static readonly OPEN: readonly string[] = [Task.QUEUED, Task.RUNNING, Task.WAITING];

  constructor(
    db: Database,
    private readonly changes: ChangeStream,
  ) {
    super(db);
  }

  async updates(actor: Actor, req: AgentUpdatesInput): Promise<AgentUpdatesView> {
    if (actor.kind !== 'device' || !actor.id || !actor.spaceId) throw new Forbidden(Actor.NEWS);
    if (!actor.can(Actor.NEWS)) actor.assertCan(Actor.DELEGATE);
    const spaceId = actor.spaceId;
    // delegate 기기는 자기가 연 대화만, news 기기는 모든 대화
    const device = actor.can(Actor.NEWS) ? null : actor.id;
    const project = ChatProject.of(req.project);
    const scope = [spaceId, device, req.chatId, project] as const;
    const last = await this.lastNumber(spaceId);
    if (req.after !== null && req.after > last)
      throw new RuleViolation(`없는 소식을 가리키는 커서예요 (지금 가장 큰 번호 ${last})`);
    const deadline = Date.now() + req.waitSeconds * 1000;
    for (;;) {
      const news = await this.news(...scope, req.after);
      const left = deadline - Date.now();
      if (news.length > 0 || left <= 0 || this.changes.closed) {
        const cursor = Number(news.at(-1)?.n ?? req.after ?? last);
        return new AgentUpdatesView(news, cursor, await this.board(...scope));
      }
      await this.changes.wait(
        (signal) => signal.spaceId === spaceId && signal.topic === ChatUpdates.TOPIC,
        Math.min(left, ChatUpdateQuery.RECHECK_MS),
      );
    }
  }

  /**
   * next_jobs: 빌려 주는 일이 대화의 일이면 덧붙인 말(이 회차 작업에)과 팀 소식(이 일 아래 작업들이 남긴 중간 보고 · 정한 것 · 가정,
   * 최근 TEAM개). 둘 다 없으면 null. 러너가 빌리는 중이라 호출자는 run 권한이다
   */
  async forJob(actor: Actor, taskId: string): Promise<JobChatView | null> {
    actor.assertCan(Actor.RUN);
    const sql = this.sql;
    // 첫 회차는 맡기 전에 글로 한 답(회차 작업이 없는 덧붙인 말)도 함께 받는다 (2차 1-5)
    const appended = await sql<ChatUpdateLine[]>`
      SELECT u.*, NULL AS agent, NULL AS choice_list FROM task.chat_updates u
      WHERE u.kind = ${ChatUpdates.APPENDED}
        AND (u.task_id = ${taskId} OR (u.task_id IS NULL AND u.chat_id = (
          SELECT (t.payload->'chat'->>'chatId')::uuid FROM task.tasks t WHERE t.id = ${taskId}
            AND t.request_id = ${ChatRequest.TURN_PREFIX} || (t.payload->'chat'->>'chatId') || ':1')))
      ORDER BY u.n`;
    const team = await sql<ChatUpdateLine[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM task.tasks WHERE parent_id = ${taskId}
        UNION ALL
        SELECT t.id FROM task.tasks t JOIN tree ON t.parent_id = tree.id
      )
      SELECT u.*, a.name AS agent, NULL AS choice_list FROM task.chat_updates u
      LEFT JOIN task.agents a ON a.id = u.agent_id
      WHERE u.task_id IN (SELECT id FROM tree)
        AND u.kind = ANY(${ChatUpdates.POSTED as string[]}::text[])
      ORDER BY u.n DESC LIMIT ${ChatUpdateQuery.TEAM}`;
    const view = new JobChatView(appended, team.reverse());
    return view.empty ? null : view;
  }

  /** 관리자의 상태판 (대화 목록 · 상세): 공간의 대화 limit개, chatId를 주면 그 대화 하나 */
  ownerBoard(actor: Actor, chatId: string | null, limit = ChatUpdateQuery.BOARD) {
    actor.assertOwner();
    return this.board(actor.requireSpace(), null, chatId, null, limit);
  }

  private async lastNumber(spaceId: string): Promise<number> {
    const [row] = await this.sql<{ n: string | null }[]>`
      SELECT max(n) AS n FROM task.chat_updates WHERE space_id = ${spaceId}`;
    return Number(row?.n ?? 0);
  }

  /** 범위(공간 · 기기 · 대화 · 프로젝트) 안의 after 다음 소식. after가 없으면 최근 것 */
  private async news(
    spaceId: string,
    device: string | null,
    chatId: string | null,
    project: string | null,
    after: number | null,
  ): Promise<ChatUpdateLine[]> {
    const sql = this.sql;
    const rows = await sql<ChatUpdateLine[]>`
      SELECT u.*, a.name AS agent,
        (SELECT json_agg(json_build_object('id', x.id, 'name', x.name,
            'role', split_part(x.role, E'\n', 1)) ORDER BY o.ord)
          FROM unnest(u.choices) WITH ORDINALITY AS o(id, ord)
          JOIN task.agents x ON x.id = o.id) AS choice_list
      FROM task.chat_updates u
      JOIN task.chats c ON c.id = u.chat_id
      LEFT JOIN task.agents a ON a.id = u.agent_id
      WHERE u.space_id = ${spaceId}
        ${device === null ? sql`` : sql`AND c.device_id = ${device}`}
        ${chatId === null ? sql`` : sql`AND c.id = ${chatId}`}
        ${project === null ? sql`` : sql`AND c.project = ${project}`}
        AND u.tx < pg_snapshot_xmin(pg_current_snapshot())
        ${after === null ? sql`` : sql`AND u.n > ${after}`}
      ORDER BY u.n ${after === null ? sql`DESC` : sql`ASC`}
      LIMIT ${after === null ? ChatUpdateQuery.RECENT : ChatUpdateQuery.PAGE}`;
    return after === null ? rows.reverse() : rows;
  }

  /**
   * 대화마다 상태와 지금 도는 작업 수 (마지막 회차 · 그 덧붙인 말의 답 아래 전부).
   * 상태: 맡기 전이면 배정 일이 돌 때 routing, 아니면 asking (2차 1-5). 맡은 뒤에는 마지막 회차로:
   * 결재를 기다리면 waiting_approval, 끝나지 않았으면 working, 실패 · 취소면 failed, 아니면 done
   */
  private async board(
    spaceId: string,
    device: string | null,
    chatId: string | null,
    project: string | null,
    limit = ChatUpdateQuery.BOARD,
  ): Promise<ChatBoardRow[]> {
    const sql = this.sql;
    const prefix = ChatRequest.TURN_PREFIX;
    const replies = Array.from({ length: ChatUpdates.APPEND_MAX }, (_, i) => `:reply:${i + 1}`);
    return await sql<ChatBoardRow[]>`
      SELECT c.*, a.name AS partner,
        CASE
          WHEN c.agent_id IS NULL THEN
            CASE WHEN EXISTS (SELECT 1 FROM task.tasks r WHERE r.space_id = c.space_id
              AND r.request_id LIKE ${ChatRequest.ROUTE_PREFIX} || c.id || ':%'
              AND r.status = ANY(${[Task.QUEUED, Task.RUNNING]}::text[])) THEN 'routing' ELSE 'asking' END
          WHEN EXISTS (SELECT 1 FROM task.approvals card WHERE card.action = ${Approval.CARD}
            AND card.target_id = c.id AND card.status = ${Approval.PENDING}) THEN 'waiting_approval'
          WHEN last.status = ${Task.WAITING} AND last.wait_reason = ${Task.WAIT_APPROVAL} THEN 'waiting_approval'
          WHEN last.status = ANY(${ChatUpdateQuery.OPEN as string[]}::text[]) THEN 'working'
          WHEN last.status = ANY(${[Task.FAILED, Task.CANCELLED]}::text[]) THEN 'failed'
          ELSE 'done' END AS state,
        (WITH RECURSIVE tree AS (
           SELECT t.id, t.status FROM task.tasks t
           WHERE t.space_id = c.space_id AND t.request_id = ANY(
             SELECT ${prefix} || c.id || ':' || c.turns || x FROM unnest(${['', ...replies]}::text[]) AS x)
           UNION ALL
           SELECT t.id, t.status FROM task.tasks t JOIN tree ON t.parent_id = tree.id
         ) SELECT count(*) FROM tree WHERE status = ANY(${ChatUpdateQuery.OPEN as string[]}::text[])) AS active
      FROM task.chats c
      LEFT JOIN task.agents a ON a.id = c.agent_id
      LEFT JOIN task.tasks last
        ON last.space_id = c.space_id AND last.request_id = ${prefix} || c.id || ':' || c.turns
      WHERE c.space_id = ${spaceId}
        ${device === null ? sql`` : sql`AND c.device_id = ${device}`}
        ${chatId === null ? sql`` : sql`AND c.id = ${chatId}`}
        ${project === null ? sql`` : sql`AND c.project = ${project}`}
      ORDER BY c.updated_at DESC, c.id DESC LIMIT ${limit}`;
  }
}
