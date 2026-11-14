import type { ProjectRuleRow } from '../vault.tables';

/** 프로젝트 하나: 세션에 나온 프로젝트와 규칙을 합친 줄 (규칙이 없으면 모은다) */
export interface ProjectLine extends Pick<ProjectRuleRow, 'project' | 'collect'> {
  sessions: number;
  last_at: Date | null;
}

/** 프로젝트 목록 (관리자): 세션 수 · 마지막으로 들어온 때 · 모으는가 */
export class ProjectRuleListView {
  constructor(private readonly rows: readonly ProjectLine[]) {}

  toJSON() {
    return {
      projects: this.rows.map((r) => ({
        project: r.project,
        collect: r.collect,
        sessions: r.sessions,
        lastAt: r.last_at?.toISOString() ?? null,
      })),
    };
  }
}
