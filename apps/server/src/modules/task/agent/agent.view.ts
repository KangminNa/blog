import type { AgentRevisionRow, AgentRow, HeartbeatRow } from '../task.tables';

// 에이전트의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 시각을 ISO 문자열로. 에이전트 목록은 하트비트를 to_jsonb로 읽어 시각이 글자로 온다 */
function iso(at: Date | string | null): string | null {
  return at === null ? null : new Date(at).toISOString();
}

/** 에이전트의 하트비트 (정해진 시각에 깨우기). 정한 적이 없으면 에이전트의 heartbeat가 null */
export class AgentHeartbeatView {
  constructor(private readonly row: Readonly<HeartbeatRow>) {}

  toJSON() {
    const r = this.row;
    const at = r.at_minute;
    return {
      enabled: r.enabled,
      mode: r.mode,
      atTime:
        at === null
          ? null
          : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
      weekdays: r.weekdays,
      everyHours: r.every_hours,
      timeZone: r.time_zone,
      instruction: r.instruction,
      goalId: r.goal_id,
      nextRunAt: iso(r.next_run_at),
      lastRunAt: iso(r.last_run_at),
      version: r.version,
    };
  }
}

/** 바꾼 에이전트 하나. 화면은 이 version으로 다음 변경을 보낸다 */
export class AgentSavedView {
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
      /** 보고 대상 에이전트. null이면 주인에게 보고한다 */
      reportsTo: r.reports_to,
      status: r.status,
      version: r.version,
      /** 설정 판: 주인이 정하는 칸이 바뀔 때마다 오른다 (실행 기록이 이 번호를 남긴다) */
      settingsRevision: r.settings_revision,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 에이전트 설정 판 목록 (새 판부터). settings는 그 판의 설정 칸 전부 */
export class AgentRevisionListView {
  constructor(private readonly rows: readonly Readonly<AgentRevisionRow>[]) {}

  toJSON() {
    return {
      revisions: this.rows.map((r) => ({
        revision: r.revision,
        settings: r.settings as Record<string, unknown>,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }
}

/** 목록의 에이전트 하나: 이번 달에 쓴 토큰과 하트비트까지 */
export class AgentView extends AgentSavedView {
  constructor(
    row: Readonly<AgentRow>,
    /** 이번 달에 쓴 토큰 */
    private readonly usedThisMonth: number,
    private readonly heartbeat: Readonly<HeartbeatRow> | null,
  ) {
    super(row);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      usedThisMonth: this.usedThisMonth,
      heartbeat: this.heartbeat === null ? null : new AgentHeartbeatView(this.heartbeat).toJSON(),
    };
  }
}

/** 에이전트 목록. 몇 개뿐이라 한 쪽에 다 보낸다 */
export class AgentListView {
  constructor(private readonly agents: readonly AgentView[]) {}

  toJSON() {
    return { agents: this.agents.map((a) => a.toJSON()), next: null };
  }
}
