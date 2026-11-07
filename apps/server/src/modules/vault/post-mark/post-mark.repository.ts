import { BaseRepository } from '../../platform';
import { type LoadedPostMark, PostMark } from './post-mark';

// vault.post_marks ↔ PostMark. 글 이벤트를 받는 Handler만 쓴다. 열쇠가 post_id이고 version 대신 글 버전을 본다.
export class PostMarkRepository extends BaseRepository<PostMark> {
  protected toEntity(row: LoadedPostMark): PostMark {
    return PostMark.restore(row);
  }

  /** 글 하나의 사본을 잠근다. 같은 글의 첫 이벤트가 겹쳐도 하나씩 처리하도록 행이 없어도 그 자리를 잠근다 */
  async lock(postId: string): Promise<PostMark | null> {
    const place = `vault.post_mark:${postId}`;
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${place}, 0))`;
    return this.maybeOne(
      await this.sql`
        SELECT *, post_id AS id FROM vault.post_marks WHERE post_id = ${postId} FOR UPDATE`,
    );
  }

  /** 받은 것이 있으면 사본을 통째로 맞춘다. 대표 wiki가 이 공간에 없으면 비워 둔다: 이벤트의 값 때문에 외래키가 일꾼을 멈추지 않게 */
  async save(mark: PostMark): Promise<void> {
    if (Object.keys(mark.unsaved).length === 0) return;
    const { id: _id, ...row } = mark.copy;
    const columns = {
      ...row,
      main_wiki_id: this.sql`(SELECT node_id FROM vault.wikis
        WHERE node_id = ${row.main_wiki_id}::uuid AND space_id = ${row.space_id})`,
    };
    await this.sql`
      INSERT INTO vault.post_marks ${this.sql(columns as never)}
      ON CONFLICT (post_id) DO UPDATE SET
        title = EXCLUDED.title, slug = EXCLUDED.slug, status = EXCLUDED.status,
        main_wiki_id = EXCLUDED.main_wiki_id, ref_wiki_ids = EXCLUDED.ref_wiki_ids,
        post_version = EXCLUDED.post_version, updated_at = EXCLUDED.updated_at`;
  }
}
