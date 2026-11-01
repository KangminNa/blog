// 사용량의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 에이전트 하나의 토큰 사용량과 한도 */
export class AgentUsageView {
  constructor(
    readonly id: string,
    /** 지난 5시간에 쓴 토큰 */
    readonly fiveHourTokens: number,
    /** 이번 달에 쓴 토큰 */
    readonly monthTokens: number,
    readonly fiveHourLimit: number | null,
    readonly monthlyLimit: number | null,
    readonly planStopPercent: number | null,
    /** 새 일을 쉬는 중인가. 저장하지 않고 읽을 때 계산한다 */
    readonly holding: boolean,
  ) {}

  toJSON() {
    return {
      id: this.id,
      fiveHourTokens: this.fiveHourTokens,
      monthTokens: this.monthTokens,
      fiveHourLimit: this.fiveHourLimit,
      monthlyLimit: this.monthlyLimit,
      planStopPercent: this.planStopPercent,
      holding: this.holding,
    };
  }
}

/** 구독 사용률 창 하나. percent와 resetsAt이 null이면 확인 전이다 (본 적 없거나 초기화 시각이 지남) */
export class PlanWindowView {
  constructor(
    readonly tool: string,
    readonly window: string,
    readonly percent: number | null,
    readonly resetsAt: Date | null,
    readonly seenAt: Date | null,
  ) {}

  toJSON() {
    return {
      tool: this.tool,
      window: this.window,
      percent: this.percent,
      resetsAt: this.resetsAt?.toISOString() ?? null,
      seenAt: this.seenAt?.toISOString() ?? null,
    };
  }
}

/** 홈의 사용량 */
export class UsageView {
  constructor(
    readonly agents: readonly AgentUsageView[],
    readonly plan: readonly PlanWindowView[],
  ) {}

  toJSON() {
    return {
      agents: this.agents.map((a) => a.toJSON()),
      plan: this.plan.map((p) => p.toJSON()),
    };
  }
}
