import type { AgentRevisionRow, AgentRow } from '../task.tables';

// 에이전트의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 팀 템플릿의 한 사람: 에이전트의 칸에 템플릿 안의 이름표(key)와 보고 대상(같은 템플릿의 key, null이면 관리자)을 더했다 */
export type AgentTeamMemberRow = Pick<AgentRow, 'name' | 'role' | 'scopes' | 'approval_actions'> & {
  key: string;
  reports_to: string | null;
};

/**
 * 팀 템플릿 하나 (AgentTeams). needs: 이 팀이 다 돌려면 필요한 것.
 * code-runner: 만들기 · 코드 작업이 도는 코드 러너 칸, code-github: 저장소를 잇는 플러그인
 */
export type AgentTeamRow = {
  key: string;
  title: string;
  description: string;
  needs: readonly ('code-runner' | 'code-github')[];
  members: readonly AgentTeamMemberRow[];
};

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
      /** 휴지통에 넣은 때. null이면 쓰는 에이전트 */
      deletedAt: r.deleted_at?.toISOString() ?? null,
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

/** 목록의 에이전트 하나: 이번 달에 쓴 토큰과 맡은 스케줄 수까지 */
export class AgentView extends AgentSavedView {
  constructor(
    row: Readonly<AgentRow>,
    /** 이번 달에 쓴 토큰 */
    private readonly usedThisMonth: number,
    /** 이 에이전트가 담당인 스케줄 수 (스케줄 메뉴에서 정한다) */
    private readonly schedules: number,
  ) {
    super(row);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      usedThisMonth: this.usedThisMonth,
      schedules: this.schedules,
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

/** 팀 템플릿 목록 (주인만) */
export class AgentTeamListView {
  constructor(private readonly teams: readonly AgentTeamRow[]) {}

  toJSON() {
    return {
      teams: this.teams.map((t) => ({
        key: t.key,
        title: t.title,
        description: t.description,
        needs: t.needs,
        members: t.members.map((m) => ({
          key: m.key,
          name: m.name,
          role: m.role,
          scopes: m.scopes,
          approvalActions: m.approval_actions,
          reportsTo: m.reports_to,
        })),
      })),
    };
  }
}

/** 템플릿으로 만든 팀: 만든 순서(보고 대상이 앞)대로의 에이전트 */
export class AgentTeamSavedView {
  constructor(private readonly agents: readonly AgentSavedView[]) {}

  toJSON() {
    return { agents: this.agents.map((a) => a.toJSON()) };
  }
}
