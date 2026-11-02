import { Database, type DomainEvent, Outbox, RuleViolation, TableRepository } from '../../platform';
import type { PostRow } from '../blog.tables';
import { type LoadedPost, Post } from './post';

// blog.posts + post_revisions + post_wiki_refs ↔ Post. posts의 title·excerpt·head_text는 지금 판의 찾기용 사본이다.
// lock은 휴지통 글도 잠근다. load는 같은 요청이 다시 왔을 때 처음 만든 글을 돌려주려고 잠그지 않고 읽는다.
export class PostRepository extends TableRepository<PostRow, Post> {
  protected readonly table = 'blog.posts';
  protected readonly noun = '글';

  protected toEntity(row: LoadedPost): Post {
    return Post.restore(row);
  }

  /** 없을 수도 있는 글을 잠근다 (결재의 대상은 AI가 적은 값이다) */
  async lockIfAny(spaceId: string, id: string): Promise<Post | null> {
    return this.maybeOne(await this.select(spaceId, id, true));
  }

  /** 이 주소이거나 "이 주소-숫자"인 다른 글의 주소들 (휴지통 글 포함). 주소에는 %·_가 없다 (SlugPolicy) */
  async takenSlugs(spaceId: string, base: string, exceptId: string | null): Promise<Set<string>> {
    const rows = await this.sql<Pick<PostRow, 'slug'>[]>`
      SELECT slug FROM blog.posts
      WHERE space_id = ${spaceId} AND (slug = ${base} OR slug LIKE ${`${base}-%`})
        ${exceptId === null ? this.sql`` : this.sql`AND id <> ${exceptId}`}`;
    return new Set(rows.map((r) => r.slug));
  }

  override async save(post: Post): Promise<void> {
    try {
      await super.save(post);
    } catch (error) {
      if (Database.isUniqueViolation(error, 'posts_space_id_slug_key'))
        throw new RuleViolation('이미 쓰는 주소예요 (휴지통 글 포함)');
      throw error;
    }
  }

  /** 글 저장과 따로 내는 이벤트 (결재 결과: 글이 없거나 바뀌지 않았어도 알려야 작업이 끝난다) */
  async announce(event: DomainEvent): Promise<void> {
    await new Outbox(this.sql).publish([event]);
  }

  /** 새 판을 넣고, 바뀐 참고 wiki를 글에 맞춘다 */
  protected override async saveParts(post: Post): Promise<void> {
    const revision = post.addedRevision;
    if (revision) await this.sql`INSERT INTO blog.post_revisions ${this.sql(revision as never)}`;
    const refs = post.unsavedRefs;
    if (refs) await this.saveRefs(post.id, refs as string[]);
  }

  /** 그대로인 행은 두어 처음 이은 때가 남는다 */
  private async saveRefs(postId: string, refs: string[]): Promise<void> {
    await this.sql`
      DELETE FROM blog.post_wiki_refs
      WHERE post_id = ${postId} AND wiki_id <> ALL(${refs}::uuid[])`;
    await this.sql`
      INSERT INTO blog.post_wiki_refs (post_id, wiki_id)
      SELECT ${postId}::uuid, unnest(${refs}::uuid[])
      ON CONFLICT DO NOTHING`;
  }

  protected override select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT p.*, r.title AS head_title, r.body_md AS head_body,
             (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count,
             (SELECT array_agg(x.wiki_id ORDER BY x.wiki_id)
              FROM blog.post_wiki_refs x WHERE x.post_id = p.id) AS ref_wiki_ids
      FROM blog.posts p LEFT JOIN blog.post_revisions r ON r.id = p.head_revision_id
      WHERE p.id = ${id} AND p.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF p` : this.sql``}`;
  }
}
