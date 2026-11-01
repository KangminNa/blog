import { BaseRepository, type Row } from '../../platform';
import { Agent } from './agent';

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

  /** 담당을 정하지 않은 일을 맡을 에이전트: 가장 먼저 만든 움직이는 에이전트 */
  async firstActive(spaceId: string): Promise<Agent | null> {
    return this.maybeOne(
      await this.sql`
      SELECT * FROM task.agents WHERE space_id = ${spaceId} AND status = ${Agent.ACTIVE}
      ORDER BY id LIMIT 1`,
    );
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
          status, created_at)
        VALUES (${agent.id}, ${agent.spaceId}, ${agent.name}, ${agent.role}, ${agent.tool},
          ${agent.scopes as string[]}, ${agent.approvalActions as string[]}, ${agent.monthlyLimit},
          ${agent.status}, ${agent.createdAt})`;
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
