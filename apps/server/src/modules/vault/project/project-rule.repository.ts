import { BaseRepository } from '../../platform';
import type { ProjectRuleRow } from '../vault.tables';
import { ProjectRule } from './project-rule';

// vault.project_rules ↔ ProjectRule. 늘 덮어쓴다: 켜기 · 끄기는 마지막 값이 이긴다 (같은 값을 두 번 보내도 같다)
export class ProjectRuleRepository extends BaseRepository<ProjectRule> {
  protected toEntity(row: ProjectRuleRow): ProjectRule {
    return ProjectRule.restore(row);
  }

  async save(rule: ProjectRule): Promise<void> {
    await this.sql`
      INSERT INTO vault.project_rules ${this.sql(rule.unsaved as never)}
      ON CONFLICT (space_id, project) DO UPDATE
        SET collect = EXCLUDED.collect, updated_at = EXCLUDED.updated_at`;
  }
}
