// 에이전트의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

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
    /** 이번 달에 쓴 토큰 */
    readonly usedThisMonth: number,
    readonly status: string,
    readonly version: number,
    readonly createdAt: Date,
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
      usedThisMonth: this.usedThisMonth,
      status: this.status,
      version: this.version,
      createdAt: this.createdAt.toISOString(),
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
