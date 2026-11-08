import { GraphNodeRepository } from '../change/change-target.repository';
import { wikis } from '../vault.schema';
import { type LoadedWiki, Wiki } from './wiki';

// vault.nodes(wiki) + wikis + wiki_revisions ↔ Wiki. wikis의 head_text는 지금 판의 찾기용 사본이다.
export class WikiRepository extends GraphNodeRepository<LoadedWiki, Wiki> {
  protected readonly table = wikis;
  protected readonly noun = 'wiki';
  protected readonly kind = 'wiki';
  protected readonly slugKey = 'wikis_space_id_slug_key';

  protected toEntity(row: LoadedWiki): Wiki {
    return Wiki.restore(row);
  }

  /** wiki 한 줄과 휴지통 표시, 지금 판의 본문. 휴지통의 wiki도 읽는다 */
  protected override select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT w.*, w.node_id AS id, n.deleted_at, r.body_md
      FROM vault.wikis w
      JOIN vault.nodes n ON n.id = w.node_id
      LEFT JOIN vault.wiki_revisions r ON r.id = w.head_revision_id
      WHERE w.node_id = ${id} AND w.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF w` : this.sql``}`;
  }

  /** 휴지통 표시와 새 판 (판은 추가만) */
  protected override async saveParts(wiki: Wiki): Promise<void> {
    await super.saveParts(wiki);
    const revision = wiki.addedRevision;
    if (!revision) return;
    await this.sql`INSERT INTO vault.wiki_revisions ${this.sql(revision as never)}`;
    wiki.revisionSaved();
  }
}
