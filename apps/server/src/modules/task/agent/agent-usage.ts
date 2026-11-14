import type { AgentUsageView } from '../usage/usage.view';
import type { Agent } from './agent';

// 에이전트 하나의 지금 사용량 (일 빌리기 · 사용량 읽기가 함께 쓴다). 쉬는지는 Agent가 정한다
/** 에이전트 하나의 지금 사용량. 쉬는지는 Agent가 정한다 */
export class AgentUsage {
  constructor(
    readonly agent: Agent,
    readonly fiveHourTokens: number,
    readonly monthTokens: number,
    /** 유효한 창 중 가장 높은 구독 사용률. 확인 전이면 null */
    readonly planPercent: number | null,
  ) {}

  get holding(): boolean {
    return this.agent.holds(this.fiveHourTokens, this.planPercent);
  }

  /** 새 일을 줄 수 있는가 */
  get ready(): boolean {
    return !this.agent.paused && !this.holding;
  }

  view(): AgentUsageView {
    return this.agent.usageView(this.fiveHourTokens, this.monthTokens, this.holding);
  }
}
