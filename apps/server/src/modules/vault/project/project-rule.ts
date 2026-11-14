import { BaseEntity, RuleViolation } from '../../platform';
import type { ProjectRuleNew, ProjectRuleRow } from '../vault.tables';

// 프로젝트 하나의 규칙 (vault.project_rules, 2차 4단계): 그 프로젝트의 세션 원문을 모으는가.
// 수집 훅 · 확장이 올린 원문은 모으지 않는 프로젝트면 쌓지 않는다 (save_transcript의 skipped). 줄이 없으면 모은다.
// 열쇠가 id가 아니라 (공간, 프로젝트)이고 version 칸이 없어(저장은 늘 덮어쓴다) TableEntity가 아니라 BaseEntity다.
export class ProjectRule extends BaseEntity {
  /** 프로젝트 이름의 길이 (세션의 project와 같다) */
  static readonly NAME_MAX = 100;

  private constructor(private readonly row: Readonly<ProjectRuleNew>) {
    super(`${row.space_id}:${row.project}`, 1);
  }

  /** 관리자가 모으기를 켜거나 끈다 */
  static set(spaceId: string, project: string, collect: boolean, now: Date): ProjectRule {
    const name = project.trim();
    if (!name) throw new RuleViolation('프로젝트 이름이 비어 있어요');
    return new ProjectRule({ space_id: spaceId, project: name, collect, updated_at: now });
  }

  static restore(row: ProjectRuleRow): ProjectRule {
    return new ProjectRule(row);
  }

  /** 저장할 행. Repository가 부른다 */
  get unsaved(): Readonly<ProjectRuleNew> {
    return this.row;
  }
}
