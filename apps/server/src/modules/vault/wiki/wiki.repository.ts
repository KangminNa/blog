import { BaseRepository, Conflict, Database, type Row } from '../../platform';
import { Wiki } from './wiki';
import { WikiBody } from './wiki-body';

// vault.nodes(wiki) + wikis + wiki_revisions ↔ Wiki. wikis의 head_text는 지금 판의 찾기용 사본이다.
export class WikiRepository extends BaseRepository<Wiki> {
  protected toEntity(row: Row): Wiki {
    return Wiki.restore(
      String(row.node_id),
      Number(row.version),
      String(row.space_id),
      String(row.title),
      String(row.slug),
      row.category_id === null ? null : String(row.category_id),
      String(row.visibility),
      String(row.origin),
      WikiBody.parse(String(row.body_md ?? '')),
      row.head_revision_id === null ? null : String(row.head_revision_id),
      (row.pinned_sections as string[] | null) ?? [],
      Number(row.revision_count),
      new Date(row.created_at),
      new Date(row.updated_at),
      row.deleted_at === null ? null : new Date(row.deleted_at),
    );
  }

  /** 고칠 wiki를 잠근다 (휴지통 포함). 없으면 null */
  async lock(spaceId: string, id: string): Promise<Wiki | null> {
    return this.maybeOne(
      await this.sql`
        SELECT w.*, n.deleted_at, r.body_md
        FROM vault.wikis w
        JOIN vault.nodes n ON n.id = w.node_id
        LEFT JOIN vault.wiki_revisions r ON r.id = w.head_revision_id
        WHERE w.node_id = ${id} AND w.space_id = ${spaceId}
        FOR UPDATE OF w`,
    );
  }

  /** 이 주소이거나 "이 주소-숫자"인 wiki의 주소들 (휴지통 포함). 주소에는 %·_가 없다 (SlugPolicy) */
  async takenSlugs(spaceId: string, base: string): Promise<Set<string>> {
    const rows = await this.sql`
      SELECT slug FROM vault.wikis
      WHERE space_id = ${spaceId} AND (slug = ${base} OR slug LIKE ${`${base}-%`})`;
    return new Set(rows.map((r) => String(r.slug)));
  }

  async save(wiki: Wiki): Promise<void> {
    if (wiki.isNew) {
      await this.insert(wiki);
      wiki.markInserted();
    } else if (wiki.changed) {
      const result = await this.sql`
        UPDATE vault.wikis SET ${this.sql(wiki.changes)}, version = version + 1
        WHERE node_id = ${wiki.id} AND version = ${wiki.version}`;
      this.expectUpdated(result.count, wiki);
    }
    if (wiki.trashChanged) {
      await this.sql`
        UPDATE vault.nodes SET deleted_at = ${wiki.deletedAt}, purge_after = ${wiki.purgeAfter}
        WHERE id = ${wiki.id}`;
      wiki.trashSaved();
    }
    await this.saveRevision(wiki);
    wiki.clearChanges();
    await this.publishEvents(wiki);
  }

  private async insert(wiki: Wiki): Promise<void> {
    await this.sql`
      INSERT INTO vault.nodes (id, space_id, kind) VALUES (${wiki.id}, ${wiki.spaceId}, 'wiki')`;
    try {
      await this.sql`
        INSERT INTO vault.wikis (node_id, space_id, category_id, title, slug, visibility, origin,
          head_revision_id, pinned_sections, head_text, revision_count, created_at, updated_at)
        VALUES (${wiki.id}, ${wiki.spaceId}, ${wiki.categoryId}, ${wiki.title}, ${wiki.slug},
          ${wiki.visibility}, ${wiki.origin}, ${wiki.headRevisionId},
          ${wiki.pinnedSections as string[]}, ${wiki.body.markdown}, ${wiki.revisionCount},
          ${wiki.createdAt}, ${wiki.updatedAt})`;
    } catch (error) {
      if (Database.isUniqueViolation(error, 'wikis_space_id_slug_key'))
        throw new Conflict('이미 쓰는 주소예요 (휴지통 포함)');
      throw error;
    }
  }

  private async saveRevision(wiki: Wiki): Promise<void> {
    const revision = wiki.addedRevision;
    if (!revision) return;
    await this.sql`
      INSERT INTO vault.wiki_revisions (id, wiki_id, seq, kind, base_revision_id, change_set_id, body_md,
        sections, section_hashes, content_hash, actor_type, actor_id, created_at)
      VALUES (${revision.id}, ${wiki.id}, ${revision.seq}, ${revision.kind}, ${revision.baseRevisionId},
        ${revision.changeSetId}, ${revision.body.markdown},
        ${this.sql.json(revision.body.sections.map((s) => s.toJSON()) as never)},
        ${this.sql.json(revision.body.sectionHashes())}, ${revision.body.hash},
        ${revision.actorType}, ${revision.actorId}, ${revision.createdAt})`;
    wiki.revisionSaved();
  }
}
