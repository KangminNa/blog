import { BaseRepository, type Row } from '../../platform';
import { PostMark } from './post-mark';

// vault.post_marks ↔ PostMark. 글 이벤트를 받는 Handler만 쓴다.
export class PostMarkRepository extends BaseRepository<PostMark> {
  protected toEntity(row: Row): PostMark {
    return PostMark.restore(
      String(row.post_id),
      String(row.space_id),
      Number(row.post_version),
      String(row.title),
      String(row.slug),
      String(row.status),
      row.main_wiki_id === null ? null : String(row.main_wiki_id),
      (row.ref_wiki_ids as string[] | null) ?? [],
      new Date(row.updated_at),
    );
  }

  /** 글 하나의 사본을 잠근다. 같은 글의 첫 이벤트가 겹쳐도 하나씩 처리하도록 행이 없어도 그 자리를 잠근다 */
  async lock(postId: string): Promise<PostMark | null> {
    const place = `vault.post_mark:${postId}`;
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${place}, 0))`;
    return this.maybeOne(
      await this.sql`SELECT * FROM vault.post_marks WHERE post_id = ${postId} FOR UPDATE`,
    );
  }

  /** 대표 wiki가 이 공간에 없으면 비워 둔다: 이벤트의 값 때문에 외래키가 일꾼을 멈추지 않게 */
  async save(mark: PostMark): Promise<void> {
    if (!mark.dirty) return;
    await this.sql`
      INSERT INTO vault.post_marks (post_id, space_id, title, slug, status, main_wiki_id,
        ref_wiki_ids, post_version, updated_at)
      VALUES (${mark.postId}, ${mark.spaceId}, ${mark.title}, ${mark.slug}, ${mark.status},
        (SELECT node_id FROM vault.wikis
          WHERE node_id = ${mark.mainWikiId}::uuid AND space_id = ${mark.spaceId}),
        ${mark.refWikiIds as string[]}::uuid[], ${mark.version}, ${mark.updatedAt})
      ON CONFLICT (post_id) DO UPDATE SET
        title = EXCLUDED.title, slug = EXCLUDED.slug, status = EXCLUDED.status,
        main_wiki_id = EXCLUDED.main_wiki_id, ref_wiki_ids = EXCLUDED.ref_wiki_ids,
        post_version = EXCLUDED.post_version, updated_at = EXCLUDED.updated_at`;
  }
}
