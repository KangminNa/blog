import { Injectable } from '@nestjs/common';
import {
  type Actor,
  EntityService,
  Idempotency,
  type Sql,
  type VersionInput,
} from '../../platform';
import { Agent } from './agent';
import type { CreateAgentInput, UpdateAgentInput } from './agent.input';
import { AgentRepository } from './agent.repository';

// 에이전트 쓰기: 만들기, 고치기, 멈추기, 다시 시작. 모두 주인만.
@Injectable()
export class AgentService extends EntityService<Agent> {
  private static readonly CREATE = 'create_agent';

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
      await agents.save(agent);
      await once.remember({ agentId: agent.id });
      return agent;
    });
  }

  update(actor: Actor, req: UpdateAgentInput): Promise<Agent> {
    return this.changeAsOwner(actor, req, (agent) => agent.edit(req.changes));
  }

  pause(actor: Actor, req: VersionInput): Promise<Agent> {
    return this.changeAsOwner(actor, req, (agent) => agent.pause());
  }

  resume(actor: Actor, req: VersionInput): Promise<Agent> {
    return this.changeAsOwner(actor, req, (agent) => agent.resume());
  }
}
