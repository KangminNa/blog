import { Injectable } from '@nestjs/common';
import {
  type Actor,
  EntityService,
  Idempotency,
  type Sql,
  type VersionInput,
} from '../../platform';
import { Agent } from './agent';
import type { CreateAgentInput, CreateAgentTeamInput, UpdateAgentInput } from './agent.input';
import { AgentRepository } from './agent.repository';
import { AgentTeams } from './agent-team.policy';

// 에이전트 쓰기: 만들기, 고치기, 멈추기, 다시 시작. 모두 주인만.
// 보고 대상을 정할 때는 조직도 전체를 잠근다 (AgentRepository.lockAll): 동시에 바꿔도 순환이 생기지 않게.
@Injectable()
export class AgentService extends EntityService<Agent> {
  private static readonly CREATE = 'create_agent';
  private static readonly CREATE_TEAM = 'create_agent_team';

  protected store(tx: Sql): AgentRepository {
    return new AgentRepository(tx);
  }

  /** 같은 requestId가 다시 오면 처음 만든 에이전트를 돌려준다 */
  async create(actor: Actor, req: CreateAgentInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, AgentService.CREATE);
      const before = await once.previous();
      if (before) return agents.load(spaceId, String(before.agentId));
      const agent = Agent.open(spaceId, req.fields, new Date());
      if (req.reportsTo !== null) agent.reportTo(req.reportsTo, await agents.lockAll(spaceId));
      await agents.save(agent);
      await once.remember({ agentId: agent.id });
      return agent;
    });
  }

  /**
   * 템플릿으로 팀 하나를 한 트랜잭션에서 만든다 (반쪽 팀이 남지 않게). 조직도 전체를 잠근 뒤 보고 대상이 앞인 순서로
   * 만들고 잇는다. 같은 requestId가 다시 오면 처음 만든 팀을 돌려준다
   */
  async createTeam(actor: Actor, req: CreateAgentTeamInput): Promise<readonly Agent[]> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const team = AgentTeams.of(req.team);
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const once = new Idempotency(
        tx,
        actor.id ?? spaceId,
        req.requestId,
        AgentService.CREATE_TEAM,
      );
      const before = await once.previous();
      if (before)
        return Promise.all((before.agentIds as string[]).map((id) => agents.load(spaceId, id)));
      const org = [...(await agents.lockAll(spaceId))];
      const made = new Map<string, Agent>();
      const now = new Date();
      for (const m of team.members) {
        const agent = Agent.open(
          spaceId,
          {
            name: m.name,
            role: m.role,
            tool: req.tool,
            scopes: m.scopes,
            approval_actions: m.approval_actions,
          },
          now,
        );
        org.push(agent);
        agent.reportTo(m.reports_to === null ? null : (made.get(m.reports_to)?.id ?? null), org);
        made.set(m.key, agent);
      }
      for (const agent of made.values()) await agents.save(agent);
      await once.remember({ agentIds: [...made.values()].map((a) => a.id) });
      return [...made.values()];
    });
  }

  /** 보고 대상을 바꾸지 않으면 그 에이전트만 잠근다 */
  async update(actor: Actor, req: UpdateAgentInput): Promise<Agent> {
    const { reportsTo } = req;
    if (reportsTo === undefined)
      return this.changeAsOwner(actor, req, (agent) => agent.edit(req.changes));
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const org = await agents.lockAll(spaceId);
      const agent = org.find((a) => a.id === req.id) ?? (await agents.lock(spaceId, req.id));
      agent.assertVersion(req.version);
      agent.reportTo(reportsTo, org);
      agent.edit(req.changes);
      await agents.save(agent);
      return agent;
    });
  }

  pause(actor: Actor, req: VersionInput): Promise<Agent> {
    return this.changeAsOwner(actor, req, (agent) => agent.pause());
  }

  resume(actor: Actor, req: VersionInput): Promise<Agent> {
    return this.changeAsOwner(actor, req, (agent) => agent.resume());
  }
}
