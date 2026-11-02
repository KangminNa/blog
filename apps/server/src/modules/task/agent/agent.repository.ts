import { TableRepository } from '../../platform';
import type { AgentRow } from '../task.tables';
import { PlanUsage } from '../usage/plan-usage';
import { PlanUsageRepository } from '../usage/plan-usage.repository';
import { Agent, AgentUsage } from './agent';

// task.agents ↔ Agent. 불러오기와 저장은 기반이 하고, 여기에는 사용량 SQL만 있다.
export class AgentRepository extends TableRepository<AgentRow, Agent> {
  protected readonly table = 'task.agents';
  protected readonly noun = '에이전트';

  protected toEntity(row: AgentRow): Agent {
    return Agent.restore(row);
  }

  /**
   * 공간의 모든 에이전트와 지금 사용량. 만든 순서대로. 잠그지 않는다.
   * 일을 빌릴 때와 홈의 사용량이 같은 값을 보게 한 곳에서 읽는다.
   */
  async usage(spaceId: string, now: Date): Promise<readonly AgentUsage[]> {
    const plan = await new PlanUsageRepository(this.sql).list(spaceId);
    const rows = await this.sql<(AgentRow & { five_hour_tokens: number; month_tokens: number })[]>`
      SELECT a.*,
        coalesce(u.five_hour, 0)::bigint AS five_hour_tokens,
        coalesce(u.month, 0)::bigint AS month_tokens
      FROM task.agents a
      LEFT JOIN LATERAL (
        SELECT
          sum(e.tokens) FILTER (WHERE e.at > ${now}::timestamptz - interval '5 hours') AS five_hour,
          sum(e.tokens) FILTER (WHERE e.at >= date_trunc('month', ${now}::timestamptz)) AS month
        FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
        WHERE t.agent_id = a.id AND e.tokens > 0
          AND e.at >= least(
            ${now}::timestamptz - interval '5 hours',
            date_trunc('month', ${now}::timestamptz)
          )
      ) u ON true
      WHERE a.space_id = ${spaceId}
      ORDER BY a.id`;
    return rows.map((row) => {
      const agent = this.toEntity(row);
      return new AgentUsage(
        agent,
        row.five_hour_tokens,
        row.month_tokens,
        PlanUsage.highest(plan, agent.tool, now),
      );
    });
  }

  /** 이번 달에 쓴 토큰. 원본은 실행 기록이다 */
  async usedThisMonth(agentId: string, now: Date): Promise<number> {
    const [row] = await this.sql`
      SELECT coalesce(sum(e.tokens), 0)::bigint AS used
      FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
      WHERE t.agent_id = ${agentId} AND e.at >= date_trunc('month', ${now}::timestamptz)`;
    return Number(row?.used ?? 0);
  }
}
