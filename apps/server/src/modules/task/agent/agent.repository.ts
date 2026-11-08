import { asc, eq, QueryTemplate, TableRepository } from '../../platform';
import { agents } from '../task.schema';
import type { AgentRow } from '../task.tables';
import { PlanUsage } from '../usage/plan-usage';
import { PlanUsageRepository } from '../usage/plan-usage.repository';
import { Agent, AgentUsage } from './agent';

// task.agents ↔ Agent. 불러오기와 저장은 기반이 하고, 여기에는 조직도와 사용량 SQL만 있다.
export class AgentRepository extends TableRepository<AgentRow, Agent> {
  /** 공간의 모든 에이전트, 만든 순서 */
  private static readonly ALL = QueryTemplate.of<{ space: string }, AgentRow>((q) =>
    q
      .select()
      .from(agents)
      .where(eq(agents.space_id, QueryTemplate.value('space')))
      .orderBy(asc(agents.id)),
  );
  /** 공간의 모든 에이전트를 만든 순서대로 잠근다 */
  private static readonly LOCK_ALL = QueryTemplate.of<{ space: string }, AgentRow>((q) =>
    q
      .select()
      .from(agents)
      .where(eq(agents.space_id, QueryTemplate.value('space')))
      .orderBy(asc(agents.id))
      .for('update'),
  );

  protected readonly table = agents;
  protected readonly noun = '에이전트';

  protected toEntity(row: AgentRow): Agent {
    return Agent.restore(row);
  }

  /** 공간의 모든 에이전트 (만든 순서). 잠그지 않는다: 위임할 때 바로 아래 팀을 찾는다 */
  async all(spaceId: string): Promise<readonly Agent[]> {
    const rows = await AgentRepository.ALL.rows(this.sql, { space: spaceId });
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * 공간의 모든 에이전트를 만든 순서대로 잠근다. 조직도를 바꿀 때: 둘이 동시에 서로에게 보고하게 바꾸면
   * 각자 본 조직도에는 순환이 없어 둘 다 통과하므로, 조직도 전체를 같은 순서로 잠가 한 번에 하나만 바꾼다.
   */
  async lockAll(spaceId: string): Promise<readonly Agent[]> {
    const rows = await AgentRepository.LOCK_ALL.rows(this.sql, { space: spaceId });
    return rows.map((r) => this.toEntity(r));
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
    const [row] = await this.sql<{ used: number }[]>`
      SELECT coalesce(sum(e.tokens), 0)::bigint AS used
      FROM task.task_events e JOIN task.tasks t ON t.id = e.task_id
      WHERE t.agent_id = ${agentId} AND e.at >= date_trunc('month', ${now}::timestamptz)`;
    return row?.used ?? 0;
  }
}
