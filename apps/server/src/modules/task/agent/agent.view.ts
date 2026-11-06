// 에이전트의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 에이전트의 하트비트 (정해진 시각에 깨우기). 정한 적이 없으면 에이전트의 heartbeat가 null */
export class AgentHeartbeatView {
  constructor(
    readonly enabled: boolean,
    /** daily · hourly */
    readonly mode: string,
    /** 매일의 하루 중 분 (570 → "09:30") */
    readonly atMinute: number | null,
    /** ISO 요일 (월 1 ~ 일 7) */
    readonly weekdays: readonly number[],
    readonly everyHours: number | null,
    readonly timeZone: string,
    readonly instruction: string,
    readonly goalId: string | null,
    readonly nextRunAt: Date | null,
    readonly lastRunAt: Date | null,
    readonly version: number,
  ) {}

  toJSON() {
    const at = this.atMinute;
    return {
      enabled: this.enabled,
      mode: this.mode,
      atTime:
        at === null
          ? null
          : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
      weekdays: this.weekdays,
      everyHours: this.everyHours,
      timeZone: this.timeZone,
      instruction: this.instruction,
      goalId: this.goalId,
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      version: this.version,
    };
  }
}

/** 에이전트 하나 */
export class AgentView {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly role: string,
    readonly tool: string,
    readonly scopes: readonly string[],
    readonly approvalActions: readonly string[],
    readonly monthlyLimit: number | null,
    readonly fiveHourLimit: number | null,
    readonly planStopPercent: number | null,
    /** 보고 대상 에이전트. null이면 주인에게 보고한다 */
    readonly reportsTo: string | null,
    /** 이번 달에 쓴 토큰 */
    readonly usedThisMonth: number,
    readonly status: string,
    readonly version: number,
    readonly createdAt: Date,
    readonly heartbeat: AgentHeartbeatView | null,
  ) {}

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      tool: this.tool,
      scopes: this.scopes,
      approvalActions: this.approvalActions,
      monthlyLimit: this.monthlyLimit,
      fiveHourLimit: this.fiveHourLimit,
      planStopPercent: this.planStopPercent,
      reportsTo: this.reportsTo,
      usedThisMonth: this.usedThisMonth,
      status: this.status,
      version: this.version,
      createdAt: this.createdAt.toISOString(),
      heartbeat: this.heartbeat?.toJSON() ?? null,
    };
  }
}

/** 에이전트 목록. 몇 개뿐이라 한 쪽에 다 보낸다 */
export class AgentListView {
  constructor(readonly agents: readonly AgentView[]) {}

  toJSON() {
    return { agents: this.agents.map((a) => a.toJSON()), next: null };
  }
}
