import type { AgentRow } from '../task.tables';

// 에이전트의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 에이전트 하나 */
export class AgentView {
  constructor(private readonly row: Readonly<AgentRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      tool: r.tool,
      scopes: r.scopes,
      approvalActions: r.approval_actions,
      monthlyLimit: r.monthly_limit,
      fiveHourLimit: r.five_hour_limit,
      planStopPercent: r.plan_stop_percent,
      status: r.status,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 목록의 에이전트 하나: 이번 달에 쓴 토큰까지 */
export class AgentListItem extends AgentView {
  constructor(
    row: Readonly<AgentRow>,
    private readonly usedThisMonth: number,
  ) {
    super(row);
  }

  override toJSON() {
    return { ...super.toJSON(), usedThisMonth: this.usedThisMonth };
  }
}

/** 에이전트 목록. 몇 개뿐이라 한 쪽에 다 보낸다 */
export class AgentListView {
  constructor(private readonly agents: readonly AgentListItem[]) {}

  toJSON() {
    return { agents: this.agents.map((a) => a.toJSON()), next: null };
  }
}
