import { TableRepository } from '../../platform';
import { skillRevisions, skills } from '../task.schema';
import type { SkillRevisionRow, SkillRow } from '../task.tables';
import { Skill } from './skill';

// task.skills ↔ Skill. 판(task.skill_revisions)은 saveParts로 함께 넣는다 (추가만).
export class SkillRepository extends TableRepository<SkillRow, Skill> {
  protected readonly table = skills;
  protected readonly noun = '스킬';

  protected toEntity(row: SkillRow): Skill {
    return Skill.restore(row);
  }

  /**
   * 이름으로 잠근다. 콘솔 판이 아직 없으면 null.
   * 줄이 없을 수도 있어 먼저 공간 · 이름으로 advisory 잠금을 건다: 동시에 처음 고치는 둘이 줄을 하나씩 만들지 않게
   */
  async lockByName(spaceId: string, name: string): Promise<Skill | null> {
    await this
      .sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task.skill:${spaceId}:${name}`}, 0))`;
    return this.findOne({ space_id: spaceId, name }, { lock: true });
  }

  /** 지금 쓰는 콘솔 판 (러너에게 실을 때). 저장소 판을 쓰면 null */
  async activeRevision(spaceId: string, name: string): Promise<SkillRevisionRow | null> {
    const [row] = await this.sql<SkillRevisionRow[]>`
      SELECT r.* FROM task.skills s
      JOIN task.skill_revisions r ON r.skill_id = s.id AND r.revision = s.active_revision
      WHERE s.space_id = ${spaceId} AND s.name = ${name}`;
    return row ?? null;
  }

  protected override async saveParts(skill: Skill): Promise<void> {
    const revision = skill.addedRevision;
    if (revision) await this.insertRows(skillRevisions, revision);
  }
}
