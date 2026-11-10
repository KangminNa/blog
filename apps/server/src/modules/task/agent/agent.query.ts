import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound } from '../../platform';
import { agentRevisions, agents } from '../task.schema';
import type { AgentRow, HeartbeatRow } from '../task.tables';
import { AgentListView, AgentRevisionListView, AgentView } from './agent.view';

// 에이전트 읽기. 주인만. 이번 달 사용량은 실행 기록에서 더하고, 하트비트를 함께 싣는다.
@Injectable()
export class AgentQuery extends BaseQuery {
  /** 설정 판 목록 (새 판부터). 실행 기록의 agentRevision을 이 판과 맞춰 본다 */
  async revisions(actor: Actor, id: string): Promise<AgentRevisionListView> {
    actor.assertOwner();
    if (!(await this.exists(agents, { space_id: actor.requireSpace(), id })))
      throw new NotFound('에이전트를 찾을 수 없어요');
    return new AgentRevisionListView(
      await this.rows(agentRevisions, { agent_id: id }, { order: ['revision desc'] }),
    );
  }

  async list(actor: Actor): Promise<AgentListView> {
    actor.assertOwner();
    // 하트비트는 to_jsonb라 시각 칸이 글자로 온다 (AgentHeartbeatView가 둘 다 받는다)
    const rows = await this.sql<(AgentRow & { used: number; heartbeat: HeartbeatRow | null })[]>`
      SELECT a.*, (
        SELECT coalesce(sum(e.tokens), 0)::bigint
        FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
        WHERE t.agent_id = a.id AND e.at >= date_trunc('month', now())
      ) AS used,
      to_jsonb(h) AS heartbeat
      FROM task.agents a
      LEFT JOIN task.heartbeats h ON h.agent_id = a.id
      WHERE a.space_id = ${actor.spaceId}
      ORDER BY a.id`;
    return new AgentListView(rows.map((r) => new AgentView(r, r.used, r.heartbeat)));
  }
}
