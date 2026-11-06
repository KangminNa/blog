import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Forbidden, Idempotency } from '../../platform';
import { Agent } from './agent';
import type { AgentVersionInput, CreateAgentInput, UpdateAgentInput } from './agent.input';
import { AgentRepository } from './agent.repository';

// 에이전트 쓰기: 만들기, 고치기, 멈추기, 다시 시작. 모두 주인만.
// 보고 대상을 정할 때는 조직도 전체를 잠근다 (AgentRepository.lockAll): 동시에 바꿔도 순환이 생기지 않게.
@Injectable()
export class AgentService extends BaseService {
  private static readonly CREATE = 'create_agent';

  /** 같은 requestId가 다시 오면 처음 만든 에이전트를 돌려준다 */
  async create(actor: Actor, req: CreateAgentInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = AgentService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, AgentService.CREATE);
      const before = await once.previous();
      if (before) return agents.load(spaceId, String(before.agentId));
      const agent = Agent.open(
        spaceId,
        req.name,
        req.role,
        req.tool,
        req.scopes,
        req.approvalActions,
        req.monthlyLimit,
        req.fiveHourLimit,
        req.planStopPercent,
        new Date(),
      );
      if (req.reportsTo !== null) agent.reportTo(req.reportsTo, await agents.lockAll(spaceId));
      await agents.save(agent);
      await once.remember({ agentId: agent.id });
      return agent;
    });
  }

  async update(actor: Actor, req: UpdateAgentInput): Promise<Agent> {
    const org = req.reportsTo !== undefined;
    return this.change(actor, req.id, req.version, org, (agent, all) => {
      if (req.reportsTo !== undefined) agent.reportTo(req.reportsTo, all);
      if (req.name !== null) agent.name = req.name;
      if (req.role !== undefined) agent.role = req.role;
      if (req.tool !== null) agent.tool = req.tool;
      if (req.scopes !== null) agent.scopes = req.scopes;
      if (req.approvalActions !== null) agent.approvalActions = req.approvalActions;
      if (req.monthlyLimit !== undefined) agent.monthlyLimit = req.monthlyLimit;
      if (req.fiveHourLimit !== undefined) agent.fiveHourLimit = req.fiveHourLimit;
      if (req.planStopPercent !== undefined) agent.planStopPercent = req.planStopPercent;
    });
  }

  async pause(actor: Actor, req: AgentVersionInput): Promise<Agent> {
    return this.change(actor, req.id, req.version, false, (agent) => agent.pause());
  }

  async resume(actor: Actor, req: AgentVersionInput): Promise<Agent> {
    return this.change(actor, req.id, req.version, false, (agent) => agent.resume());
  }

  /** org면 조직도 전체를 잠그고 apply에 넘긴다 (보고 대상을 바꿀 때). 아니면 그 에이전트만 */
  private async change(
    actor: Actor,
    id: string,
    version: number,
    org: boolean,
    apply: (agent: Agent, all: readonly Agent[]) => void,
  ): Promise<Agent> {
    actor.assertOwner();
    const spaceId = AgentService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const all = org ? await agents.lockAll(spaceId) : [];
      const agent = all.find((a) => a.id === id) ?? (await agents.lock(spaceId, id));
      agent.assertVersion(version);
      apply(agent, all);
      await agents.save(agent);
      return agent;
    });
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden('owner');
    return actor.spaceId;
  }
}
