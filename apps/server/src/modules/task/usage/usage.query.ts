import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Forbidden } from '../../platform';
import { Agent } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { PlanUsage } from './plan-usage';
import { PlanUsageRepository } from './plan-usage.repository';
import { AgentUsageView, PlanWindowView, UsageView } from './usage.view';

// 사용량 읽기. 주인만. 쉬는지와 창이 유효한지는 일을 빌릴 때와 같은 규칙(Agent.holds, PlanUsage.validAt)으로 정한다.
@Injectable()
export class UsageQuery extends BaseQuery {
  async overview(actor: Actor): Promise<UsageView> {
    actor.assertOwner();
    if (!actor.spaceId) throw new Forbidden('owner');
    const now = new Date();
    const usage = await new AgentRepository(this.sql).usage(actor.spaceId, now);
    const seen = await new PlanUsageRepository(this.sql).list(actor.spaceId);
    const agents = usage.map(
      (u) =>
        new AgentUsageView(
          u.agent.id,
          u.fiveHourTokens,
          u.monthTokens,
          u.agent.fiveHourLimit,
          u.agent.monthlyLimit,
          u.agent.planStopPercent,
          u.holding,
        ),
    );
    // 값이 없는 창도 보낸다: 화면이 확인 전으로 보여 준다
    const tools = new Set([...usage.map((u) => u.agent.tool), ...seen.map((p) => p.tool)]);
    const plan = Agent.TOOLS.filter((tool) => tools.has(tool)).flatMap((tool) =>
      PlanUsage.WINDOWS.map((window) =>
        UsageQuery.window(
          tool,
          window,
          seen.find((p) => p.tool === tool && p.window === window),
          now,
        ),
      ),
    );
    return new UsageView(agents, plan);
  }

  private static window(
    tool: string,
    window: string,
    seen: PlanUsage | undefined,
    now: Date,
  ): PlanWindowView {
    const valid = seen?.validAt(now) === true;
    return new PlanWindowView(
      tool,
      window,
      valid ? seen.percent : null,
      valid ? seen.resetsAt : null,
      seen?.seenAt ?? null,
    );
  }
}
