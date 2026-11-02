import type { Sql } from '../../platform';
import type { RestoredPost } from './post-restore';

// 복원의 blog 쓰기. 글 + 첫 판 + 참고 wiki + 사진 행을 새 행으로만 넣는다.
// 칸은 PostRepository가 쓰는 것과 같다. outbox에는 남기지 않는다.
export class PostRestoreRepository {
  constructor(private readonly tx: Sql) {}

  /** 있는 글의 수 (휴지통 포함: 주소를 차지한다). 끝날 때까지 새 글이 끼어들지 못하게 잠근다 */
  async existing(): Promise<number> {
    await this.tx`LOCK TABLE blog.posts IN SHARE ROW EXCLUSIVE MODE`;
    const [row] = await this.tx`SELECT count(*)::int AS n FROM blog.posts`;
    return row?.n;
  }

  /** photos: 이 글에 붙일 사진 중 파일이 들어온 것 (행에 외래키가 있다) */
  async save(spaceId: string, p: RestoredPost, photos: readonly string[]): Promise<void> {
    await this.tx`INSERT INTO blog.posts ${this.tx(p.rowIn(spaceId) as never)}`;
    await this.tx`INSERT INTO blog.post_revisions ${this.tx(p.revision as never)}`;
    for (const wikiId of p.refWikiIds)
      await this.tx`INSERT INTO blog.post_wiki_refs ${this.tx({ post_id: p.id, wiki_id: wikiId })}`;
    for (const hash of photos)
      await this.tx`INSERT INTO blog.assets ${this.tx({ post_id: p.id, blob_hash: hash })}`;
  }
}
