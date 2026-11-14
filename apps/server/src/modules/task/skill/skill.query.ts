import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, Database, NotFound } from '../../platform';
import type { SkillRevisionRow, SkillRow } from '../task.tables';
import { RepoSkillGateway } from './repo-skill.gateway';
import { SkillDetailView, SkillListView, SkillRevisionView, SkillSummaryView } from './skill.view';
import { SkillFiles } from './skill-files';

/** 스킬 줄과 지금 쓰는 콘솔 판의 해시 · 바탕 */
interface SkillWithActive extends SkillRow {
  active_hash: string | null;
  active_based_on: string | null;
}

// 콘솔 "스킬" 메뉴의 읽기 (주인만). 목록은 저장소의 러너 스킬마다 한 줄이고, 콘솔 판이 있으면 그 판을 보인다.
@Injectable()
export class SkillQuery extends BaseQuery {
  constructor(
    db: Database,
    private readonly repo: RepoSkillGateway,
  ) {
    super(db);
  }

  async list(actor: Actor): Promise<SkillListView> {
    actor.assertOwner();
    const rows = await this.rowsOf(actor.requireSpace());
    return new SkillListView(
      [...this.repo.all()].map(([name, files]) =>
        this.summary(name, files, rows.get(name) ?? null),
      ),
    );
  }

  async detail(actor: Actor, name: string): Promise<SkillDetailView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const repo = this.runnerSkill(name);
    const row = (await this.rowsOf(spaceId, name)).get(name) ?? null;
    const revisions = row
      ? await this.sql<SkillRevisionRow[]>`
          SELECT * FROM task.skill_revisions WHERE skill_id = ${row.id} ORDER BY revision DESC`
      : [];
    const active = revisions.find((r) => r.revision === row?.active_revision);
    return new SkillDetailView(
      this.summary(name, repo, row),
      active ? (active.files as Record<string, string>) : repo.toRecord(),
      repo.hash,
      repo.toRecord(),
      revisions,
    );
  }

  async revision(actor: Actor, name: string, revision: number): Promise<SkillRevisionView> {
    actor.assertOwner();
    this.runnerSkill(name);
    if (!Number.isInteger(revision) || revision < 1)
      throw new NotFound(`없는 버전이에요: ${revision}`);
    const [row] = await this.sql<SkillRevisionRow[]>`
      SELECT r.* FROM task.skill_revisions r JOIN task.skills s ON s.id = r.skill_id
      WHERE s.space_id = ${actor.requireSpace()} AND s.name = ${name} AND r.revision = ${revision}`;
    if (!row) throw new NotFound(`없는 버전이에요: ${revision}`);
    return new SkillRevisionView(row);
  }

  /** 저장소의 러너 스킬. 아니면 404 */
  private runnerSkill(name: string): SkillFiles {
    const files = this.repo.get(name);
    if (!files) throw new NotFound(`러너 스킬이 아니에요: ${name}`);
    return files;
  }

  private summary(name: string, repo: SkillFiles, row: SkillWithActive | null): SkillSummaryView {
    const consoleActive = row?.active_revision != null && row.active_hash !== null;
    return new SkillSummaryView(
      name,
      repo.description,
      row,
      consoleActive ? (row.active_hash as string) : repo.hash,
      consoleActive && row.active_based_on !== repo.hash,
    );
  }

  private async rowsOf(
    spaceId: string,
    name?: string,
  ): Promise<ReadonlyMap<string, SkillWithActive>> {
    const rows = await this.sql<SkillWithActive[]>`
      SELECT s.*, r.hash AS active_hash, r.based_on AS active_based_on
      FROM task.skills s
      LEFT JOIN task.skill_revisions r ON r.skill_id = s.id AND r.revision = s.active_revision
      WHERE s.space_id = ${spaceId} ${name === undefined ? this.sql`` : this.sql`AND s.name = ${name}`}`;
    return new Map(rows.map((r) => [r.name, r]));
  }
}
