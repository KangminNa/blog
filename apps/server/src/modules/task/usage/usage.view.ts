import type { AgentRow, PlanUsageRow } from '../task.tables';

// 사용량의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 에이전트 하나의 토큰 사용량과 한도 */
export class AgentUsageView {
  constructor(
    private readonly row: Readonly<AgentRow>,
    /** 지난 5시간에 쓴 토큰 */
    private readonly fiveHourTokens: number,
    /** 이번 달에 쓴 토큰 */
    private readonly monthTokens: number,
    /** 새 일을 쉬는 중인가. 저장하지 않고 읽을 때 계산한다 */
    private readonly holding: boolean,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      fiveHourTokens: this.fiveHourTokens,
      monthTokens: this.monthTokens,
      fiveHourLimit: r.five_hour_limit,
      monthlyLimit: r.monthly_limit,
      planStopPercent: r.plan_stop_percent,
      holding: this.holding,
    };
  }
}

/** 구독 사용률 창 하나. percent와 resetsAt이 null이면 확인 전이다 (본 적 없거나 초기화 시각이 지남) */
export class PlanWindowView {
  constructor(
    private readonly tool: string,
    private readonly window: string,
    /** 러너가 본 값. 본 적 없으면 null */
    private readonly row: Readonly<PlanUsageRow> | null,
    /** 초기화 시각 전인가 */
    private readonly valid: boolean,
  ) {}

  toJSON() {
    const valid = this.valid ? this.row : null;
    return {
      tool: this.tool,
      window: this.window,
      percent: valid?.percent ?? null,
      resetsAt: valid?.resets_at.toISOString() ?? null,
      seenAt: this.row?.seen_at.toISOString() ?? null,
    };
  }
}

/** 홈의 사용량 */
export class UsageView {
  constructor(
    private readonly agents: readonly AgentUsageView[],
    private readonly plan: readonly PlanWindowView[],
  ) {}

  toJSON() {
    return {
      agents: this.agents.map((a) => a.toJSON()),
      plan: this.plan.map((p) => p.toJSON()),
    };
  }
}
