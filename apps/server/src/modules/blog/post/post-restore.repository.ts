import type { Sql } from '../../platform';
import type { RestoredPost } from './post-restore';

// 복원의 blog 쓰기. 글 + 첫 판 + 참고 wiki + 사진 행을 새 행으로만 넣는다.
// 칸은 PostRepository가 쓰는 것과 같다. outbox에는 남기지 않는다.
export class PostRestoreRepository {
  private static readonly SYSTEM = 'system';

  constructor(private readonly tx: Sql) {}

  /** 있는 글의 수 (휴지통 포함: 주소를 차지한다). 끝날 때까지 새 글이 끼어들지 못하게 잠근다 */
  async existing(): Promise<number> {
    await this.tx`LOCK TABLE blog.posts IN SHARE ROW EXCLUSIVE MODE`;
    const [row] = await this.tx`SELECT count(*)::int AS n FROM blog.posts`;
    return Number(row?.n);
  }

  /** photos: 이 글에 붙일 사진 중 파일이 들어온 것 (행에 외래키가 있다) */
  async save(spaceId: string, p: RestoredPost, photos: readonly string[]): Promise<void> {
    const c = p.content;
    await this.tx`
      INSERT INTO blog.posts (id, space_id, slug, status, title, excerpt, head_text, head_revision_id,
        tags, align, main_wiki_id, published_at, updated_at, meta)
      VALUES (${p.id}, ${spaceId}, ${p.slug}, ${p.status}, ${c.title}, ${c.excerpt}, ${c.searchText},
        ${p.revisionId}, ${p.tags as string[]}, ${p.align}, ${p.mainWikiId}, ${p.publishedAt},
        ${p.writtenAt}, ${this.tx.json(p.meta as never)})`;
    await this.tx`
      INSERT INTO blog.post_revisions (id, post_id, seq, title, body_md, actor_type, created_at)
      VALUES (${p.revisionId}, ${p.id}, 1, ${c.title}, ${c.body}, ${PostRestoreRepository.SYSTEM},
        ${p.writtenAt})`;
    for (const wikiId of p.refWikiIds)
      await this.tx`INSERT INTO blog.post_wiki_refs (post_id, wiki_id) VALUES (${p.id}, ${wikiId})`;
    for (const hash of photos)
      await this.tx`INSERT INTO blog.assets (post_id, blob_hash) VALUES (${p.id}, ${hash})`;
  }
}
