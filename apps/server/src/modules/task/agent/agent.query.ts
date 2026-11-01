import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, type Row } from '../../platform';
import { AgentListView, AgentView } from './agent.view';

// 에이전트 읽기. 주인만. 이번 달 사용량은 실행 기록에서 더한다.
@Injectable()
export class AgentQuery extends BaseQuery {
  async list(actor: Actor): Promise<AgentListView> {
    actor.assertOwner();
    const rows = await this.sql`
      SELECT a.*, (
        SELECT coalesce(sum(e.tokens), 0)::bigint
        FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
        WHERE t.agent_id = a.id AND e.at >= date_trunc('month', now())
      ) AS used
      FROM task.agents a
      WHERE a.space_id = ${actor.spaceId}
      ORDER BY a.id`;
    return new AgentListView(rows.map((r) => AgentQuery.view(r)));
  }

  private static view(r: Row): AgentView {
    return new AgentView(
      String(r.id),
      String(r.name),
      String(r.role),
      String(r.tool),
      (r.scopes as string[] | null) ?? [],
      (r.approval_actions as string[] | null) ?? [],
      r.monthly_limit === null ? null : Number(r.monthly_limit),
      r.five_hour_limit === null ? null : Number(r.five_hour_limit),
      r.plan_stop_percent === null ? null : Number(r.plan_stop_percent),
      Number(r.used),
      String(r.status),
      Number(r.version),
      new Date(r.created_at),
    );
  }
}
