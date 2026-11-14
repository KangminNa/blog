import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { projectRules } from '../vault.schema';
import { type ProjectLine, ProjectRuleListView } from './project-rule.view';

// 프로젝트 규칙 읽기 (2차 4단계): 원문을 모을지(원문을 올리는 기기의 저장이 묻는다), 프로젝트 목록(관리자).
@Injectable()
export class ProjectRuleQuery extends BaseQuery {
  /** 이 프로젝트의 원문을 모으는가. 규칙이 없으면 모은다 */
  async collects(actor: Actor, project: string): Promise<boolean> {
    const rule = await this.row(
      projectRules,
      { space_id: actor.requireSpace(), project },
      { columns: ['collect'] },
    );
    return rule?.collect ?? true;
  }

  /** 세션에 나온 프로젝트와 규칙만 있는 프로젝트. 최근에 들어온 것부터 */
  async list(actor: Actor): Promise<ProjectRuleListView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const rows = await this.sql<ProjectLine[]>`
      SELECT p.project, coalesce(r.collect, true) AS collect,
             coalesce(s.sessions, 0)::int AS sessions, s.last_at
      FROM (
        SELECT project FROM vault.sessions WHERE space_id = ${spaceId} AND project IS NOT NULL
        UNION SELECT project FROM vault.project_rules WHERE space_id = ${spaceId}
      ) p
      LEFT JOIN vault.project_rules r ON r.space_id = ${spaceId} AND r.project = p.project
      LEFT JOIN (
        SELECT project, count(*) AS sessions, max(last_revision_at) AS last_at
        FROM vault.sessions WHERE space_id = ${spaceId} GROUP BY project
      ) s ON s.project = p.project
      ORDER BY s.last_at DESC NULLS LAST, p.project`;
    return new ProjectRuleListView(rows);
  }
}
