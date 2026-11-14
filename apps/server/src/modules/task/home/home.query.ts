import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database } from '../../platform';
import { Approval } from '../approval/approval';
import { ChatUpdateQuery } from '../chat/chat-update.query';
import { Task } from '../task/task';
import { type HomeOutputRow, type HomeTeamRow, HomeView } from './home.view';

// 홈 읽기 (관리자만, 2차 1-1). 대화의 상태판은 agent_updates와 같은 규칙(ChatUpdateQuery.ownerBoard)으로 읽는다
@Injectable()
export class HomeQuery extends BaseQuery {
  /** 최근 결과물 수 */
  private static readonly OUTPUTS = 12;
  private static readonly OPEN: readonly string[] = [Task.QUEUED, Task.RUNNING, Task.WAITING];

  constructor(
    db: Database,
    private readonly chats: ChatUpdateQuery,
  ) {
    super(db);
  }

  async home(actor: Actor): Promise<HomeView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const [team, board, outputs, pending] = await Promise.all([
      this.team(spaceId),
      this.chats.ownerBoard(actor, null),
      this.outputs(spaceId),
      this.pending(spaceId),
    ]);
    return new HomeView(team, board, outputs, pending);
  }

  /** 관리자 바로 아래 에이전트(지운 것 빼고): 그 아래 에이전트 수와 팀 전체에서 도는 작업 수 */
  private team(spaceId: string): Promise<HomeTeamRow[]> {
    return this.sql<HomeTeamRow[]>`
      WITH RECURSIVE tree AS (
        SELECT id AS top, id FROM task.agents
        WHERE space_id = ${spaceId} AND reports_to IS NULL AND deleted_at IS NULL
        UNION ALL
        SELECT tree.top, a.id FROM task.agents a JOIN tree ON a.reports_to = tree.id
        WHERE a.deleted_at IS NULL
      )
      SELECT a.id, a.name, a.role, a.status, a.lead,
        (SELECT count(*)::int - 1 FROM tree WHERE tree.top = a.id) AS members,
        (SELECT count(*)::int FROM task.tasks t JOIN tree ON t.agent_id = tree.id
          WHERE tree.top = a.id AND t.status = ANY(${HomeQuery.OPEN as string[]}::text[])) AS open
      FROM task.agents a
      WHERE a.space_id = ${spaceId} AND a.reports_to IS NULL AND a.deleted_at IS NULL
      ORDER BY a.lead DESC, a.name, a.id`;
  }

  private outputs(spaceId: string): Promise<HomeOutputRow[]> {
    return this.sql<HomeOutputRow[]>`
      SELECT id, name, kind, mime, size_bytes, task_id, created_at FROM task.outputs
      WHERE space_id = ${spaceId} AND deleted_at IS NULL
      ORDER BY id DESC LIMIT ${HomeQuery.OUTPUTS}`;
  }

  /** 기다리는 결재 수: 대화의 일에서 올라온 결재는 결과 카드 하나로 센다 */
  private async pending(spaceId: string): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM task.approvals
      WHERE space_id = ${spaceId} AND status = ${Approval.PENDING} AND chat_id IS NULL`;
    return row?.count ?? 0;
  }
}
