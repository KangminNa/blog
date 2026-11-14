import { BaseEntity, NotFound, RuleViolation, TableEntity } from '../../platform';
import type { SkillNew, SkillRevisionNew, SkillRow } from '../task.tables';
import { SkillSavedView } from './skill.view';
import type { SkillFiles } from './skill-files';

// 러너 스킬 하나의 콘솔 판들 (task.skills + task.skill_revisions, 기획서 결정 2026-11-10).
// 저장소 판(서버 이미지의 skills/) 위에 주인이 고친 판을 얹는다. 판은 추가만 하고(트리거), 지금 쓰는 판(active_revision)만 바뀐다.
// 비어 있으면 저장소 판을 쓴다. 되돌리기도 지금 쓰는 판을 옮기는 것이다 (판 자체는 그대로).
// 스킬은 AI에게 주는 지시일 뿐이라 권한 · 결재 · 격리를 넓히지 못한다. 고치는 것은 주인만 (SkillService).
export class Skill extends TableEntity<SkillRow, SkillNew> {
  static readonly NOTE_MAX = 500;
  /** 이번에 쌓을 판 (saveParts가 넣는다) */
  private added: SkillRevisionNew | null = null;

  /** 처음 고칠 때 만든다. 판이 하나도 없으면 저장소 판을 쓴다 */
  static open(spaceId: string, name: string, now: Date): Skill {
    return new Skill(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name,
        active_revision: null,
        revisions: 0,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: SkillRow): Skill {
    return new Skill(row);
  }

  get name(): string {
    return this.row.name;
  }

  /** 지금 쓰는 콘솔 판. null이면 저장소 판 */
  get activeRevision(): number | null {
    return this.row.active_revision;
  }

  /** 주인이 고친 새 판을 쌓고 바로 그 판을 쓴다. based_on은 그때 저장소 판의 해시 */
  addRevision(files: SkillFiles, basedOn: string, note: string, now: Date): void {
    const text = note.trim();
    if (text.length > Skill.NOTE_MAX) throw new RuleViolation(`메모는 ${Skill.NOTE_MAX}자까지예요`);
    const revision = this.row.revisions + 1;
    this.put('revisions', revision);
    this.put('active_revision', revision);
    this.put('updated_at', now);
    this.added = {
      id: BaseEntity.newId(),
      skill_id: this.id,
      revision,
      files: files.toRecord(),
      hash: files.hash,
      based_on: basedOn,
      note: text,
      created_at: now,
    };
  }

  /** 쓸 판을 옮긴다. null이면 저장소 판. 이미 그 판이면 아무것도 바뀌지 않는다 */
  activate(revision: number | null, now: Date): void {
    if (revision !== null && (revision < 1 || revision > this.row.revisions))
      throw new NotFound(`없는 버전이에요: ${revision}`);
    if (revision === this.row.active_revision) return;
    this.put('active_revision', revision);
    this.put('updated_at', now);
  }

  /** 저장할 새 판 (Repository가 부른다) */
  get addedRevision(): SkillRevisionNew | null {
    return this.added;
  }

  view(): SkillSavedView {
    return new SkillSavedView(this.row);
  }
}
