import { BaseRepository, type Row } from '../../platform';
import { PlanUsage } from '../usage/plan-usage';
import { PlanUsageRepository } from '../usage/plan-usage.repository';
import { Agent, AgentUsage } from './agent';

// task.agents ↔ Agent. 고칠 때는 엔티티가 기억한 바뀐 열만 저장한다.
export class AgentRepository extends BaseRepository<Agent> {
  protected toEntity(row: Row): Agent {
    return Agent.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      String(row.name),
      String(row.role),
      String(row.tool),
      (row.scopes as string[] | null) ?? [],
      (row.approval_actions as string[] | null) ?? [],
      row.monthly_limit === null ? null : Number(row.monthly_limit),
      row.five_hour_limit === null ? null : Number(row.five_hour_limit),
      row.plan_stop_percent === null ? null : Number(row.plan_stop_percent),
      row.reports_to === null ? null : String(row.reports_to),
      String(row.status),
      new Date(row.created_at),
    );
  }

  /** 없으면 NotFound */
  async load(spaceId: string, id: string): Promise<Agent> {
    return this.one(
      await this.sql`SELECT * FROM task.agents WHERE id = ${id} AND space_id = ${spaceId}`,
      '에이전트',
    );
  }

  /** 고칠 에이전트를 잠근다. 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<Agent> {
    return this.one(
      await this
        .sql`SELECT * FROM task.agents WHERE id = ${id} AND space_id = ${spaceId} FOR UPDATE`,
      '에이전트',
    );
  }

  /**
   * 공간의 모든 에이전트를 만든 순서대로 잠근다. 조직도를 바꿀 때: 둘이 동시에 서로에게 보고하게 바꾸면
   * 각자 본 조직도에는 순환이 없어 둘 다 통과하므로, 조직도 전체를 같은 순서로 잠가 한 번에 하나만 바꾼다.
   */
  async lockAll(spaceId: string): Promise<readonly Agent[]> {
    const rows = await this.sql`
      SELECT * FROM task.agents WHERE space_id = ${spaceId} ORDER BY id FOR UPDATE`;
    return rows.map((r) => this.toEntity(r));
  }

  /**
   * 공간의 모든 에이전트와 지금 사용량. 만든 순서대로. 잠그지 않는다.
   * 일을 빌릴 때와 홈의 사용량이 같은 값을 보게 한 곳에서 읽는다.
   */
  async usage(spaceId: string, now: Date): Promise<readonly AgentUsage[]> {
    const plan = await new PlanUsageRepository(this.sql).list(spaceId);
    const rows = await this.sql`
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
        Number(row.five_hour_tokens),
        Number(row.month_tokens),
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

  async save(agent: Agent): Promise<void> {
    if (agent.isNew) {
      await this.sql`
        INSERT INTO task.agents (id, space_id, name, role, tool, scopes, approval_actions, monthly_limit,
          five_hour_limit, plan_stop_percent, reports_to, status, created_at)
        VALUES (${agent.id}, ${agent.spaceId}, ${agent.name}, ${agent.role}, ${agent.tool},
          ${agent.scopes as string[]}, ${agent.approvalActions as string[]}, ${agent.monthlyLimit},
          ${agent.fiveHourLimit}, ${agent.planStopPercent}, ${agent.reportsTo}, ${agent.status},
          ${agent.createdAt})`;
    } else if (agent.changed) {
      const result = await this.sql`
        UPDATE task.agents SET ${this.sql(agent.changes)}, version = version + 1
        WHERE id = ${agent.id} AND version = ${agent.version}`;
      this.expectUpdated(result.count, agent);
    }
    agent.clearChanges();
    await this.publishEvents(agent);
  }
}
