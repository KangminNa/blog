import { Injectable } from '@nestjs/common';
import {
  type Actor,
  Database,
  EntityService,
  Idempotency,
  NotFound,
  RuleViolation,
  type Sql,
  type VersionInput,
} from '../../platform';
import { RunnerRepository } from '../runner/runner.repository';
import { Agent } from './agent';
import type {
  CreateAgentInput,
  CreateAgentTeamInput,
  DeleteAgentInput,
  UpdateAgentInput,
} from './agent.input';
import { AgentQuery } from './agent.query';
import { AgentRepository } from './agent.repository';
import { AgentTeams } from './agent-team.policy';

// 에이전트 쓰기: 만들기, 고치기, 멈추기, 다시 시작, 휴지통 · 복원. 모두 주인만.
// 보고 대상을 정할 때는 조직도 전체를 잠근다 (AgentRepository.lockAll): 동시에 바꿔도 순환이 생기지 않게.
@Injectable()
export class AgentService extends EntityService<Agent> {
  private static readonly CREATE = 'create_agent';
  private static readonly CREATE_TEAM = 'create_agent_team';

  constructor(
    db: Database,
    private readonly agents: AgentQuery,
  ) {
    super(db);
  }

  protected store(tx: Sql): AgentRepository {
    return new AgentRepository(tx);
  }

  /**
   * 휴지통으로 (기획서 결정 2026-11-14). team이면 아래 팀 전체를 아래부터, 아니면 바로 아래 팀원을 이 에이전트의 보고 대상으로
   * 올린다. 진행 중인 작업 · 스케줄 · 도는 목표 실행이 있으면 지우지 않고 까닭을 알린다 (조용히 취소하지 않는다)
   */
  async delete(actor: Actor, req: DeleteAgentInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const org = await agents.lockAll(spaceId);
      const agent = org.find((a) => a.id === req.id && !a.deleted);
      if (!agent) throw new NotFound('에이전트를 찾을 수 없어요');
      agent.assertVersion(req.version);
      const gone = req.team ? Agent.teamUnder(agent, org) : [agent];
      const why = await this.agents.blockers(
        actor,
        gone.map((a) => a.id),
      );
      if (why.length > 0) throw new RuleViolation(`삭제할 수 없어요: ${why.join(', ')}`);
      const now = new Date();
      const moved = gone.flatMap((a) => a.delete(org, now));
      for (const a of new Set([...moved, ...gone])) await agents.save(a);
      return agent;
    });
  }

  /** 휴지통에서 되돌린다 (보고 대상이 그사이 지워졌으면 주인 아래로) */
  async restore(actor: Actor, req: VersionInput): Promise<Agent> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const org = await agents.lockAll(spaceId);
      const agent = org.find((a) => a.id === req.id);
      if (!agent) throw new NotFound('에이전트를 찾을 수 없어요');
      agent.assertVersion(req.version);
      agent.restore(org);
      await agents.save(agent);
      return agent;
    });
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
      if (req.runnerId !== null)
        agent.edit({}, await new RunnerRepository(tx).load(spaceId, req.runnerId));
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

  /** 보고 대상을 바꾸지 않으면 그 에이전트만 잠근다. 러너는 같은 공간의 것만 (없으면 404) */
  async update(actor: Actor, req: UpdateAgentInput): Promise<Agent> {
    const { reportsTo, runnerId, reviewerId } = req;
    if (reportsTo === undefined && runnerId === undefined && reviewerId === undefined)
      return this.changeAsOwner(actor, req, (agent) => agent.edit(req.changes));
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    return this.transaction(async (tx) => {
      const agents = new AgentRepository(tx);
      const org = reportsTo === undefined ? [] : await agents.lockAll(spaceId);
      const agent = org.find((a) => a.id === req.id) ?? (await agents.lock(spaceId, req.id));
      agent.assertVersion(req.version);
      if (reportsTo !== undefined) agent.reportTo(reportsTo, org);
      const runner =
        typeof runnerId === 'string'
          ? await new RunnerRepository(tx).load(spaceId, runnerId)
          : runnerId;
      agent.edit(req.changes, runner);
      if (reviewerId !== undefined)
        agent.pairReviewer(reviewerId === null ? null : await agents.load(spaceId, reviewerId));
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
