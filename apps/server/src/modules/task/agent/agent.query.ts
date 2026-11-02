import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import type { AgentRow } from '../task.tables';
import { AgentListItem, AgentListView } from './agent.view';

// 에이전트 읽기. 주인만. 이번 달 사용량은 실행 기록에서 더한다.
@Injectable()
export class AgentQuery extends BaseQuery {
  async list(actor: Actor): Promise<AgentListView> {
    actor.assertOwner();
    const rows = await this.sql<(AgentRow & { used: number })[]>`
      SELECT a.*, (
        SELECT coalesce(sum(e.tokens), 0)::bigint
        FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
        WHERE t.agent_id = a.id AND e.at >= date_trunc('month', now())
      ) AS used
      FROM task.agents a
      WHERE a.space_id = ${actor.spaceId}
      ORDER BY a.id`;
    return new AgentListView(rows.map((r) => new AgentListItem(r, r.used)));
  }
}
