import { BaseRepository, Database, type Row, RuleViolation } from '../../platform';
import { Post } from './post';
import { PostContent } from './post-content';

// blog.posts + post_revisions ↔ Post. posts의 title·excerpt·head_text는 지금 판의 찾기용 사본이다.
export class PostRepository extends BaseRepository<Post> {
  protected toEntity(row: Row): Post {
    return Post.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      String(row.slug),
      String(row.status),
      PostContent.restore(String(row.head_title ?? ''), String(row.head_body ?? '')),
      (row.tags as string[] | null) ?? [],
      String(row.align),
      row.head_revision_id === null ? null : String(row.head_revision_id),
      Number(row.revision_count),
      row.published_at === null ? null : new Date(row.published_at),
      new Date(row.updated_at),
      row.deleted_at === null ? null : new Date(row.deleted_at),
    );
  }

  /** 고칠 글 하나를 잠근다 (휴지통 글 포함). 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<Post> {
    return this.one(await this.select(spaceId, id, true), '글');
  }

  /** 잠그지 않고 읽기 (같은 요청이 다시 왔을 때 처음 만든 글을 돌려줄 때) */
  async load(spaceId: string, id: string): Promise<Post> {
    return this.one(await this.select(spaceId, id, false), '글');
  }

  /** 이 주소이거나 "이 주소-숫자"인 다른 글의 주소들 (휴지통 글 포함). 주소에는 %·_가 없다 (SlugPolicy) */
  async takenSlugs(spaceId: string, base: string, exceptId: string | null): Promise<Set<string>> {
    const rows = await this.sql`
      SELECT slug FROM blog.posts
      WHERE space_id = ${spaceId} AND (slug = ${base} OR slug LIKE ${`${base}-%`})
        ${exceptId === null ? this.sql`` : this.sql`AND id <> ${exceptId}`}`;
    return new Set(rows.map((r) => String(r.slug)));
  }

  async save(post: Post): Promise<void> {
    if (!post.changed) return;
    const c = post.content;
    try {
      if (post.isNew) {
        await this.sql`
          INSERT INTO blog.posts (id, space_id, slug, status, title, excerpt, head_text, head_revision_id,
            tags, align, published_at, updated_at)
          VALUES (${post.id}, ${post.spaceId}, ${post.slug}, ${post.status}, ${c.title}, ${c.excerpt},
            ${c.searchText}, ${post.headRevisionId}, ${post.tags as string[]}, ${post.align},
            ${post.publishedAt}, ${post.updatedAt})`;
        post.markSaved(post.version);
      } else {
        const result = await this.sql`
          UPDATE blog.posts SET slug = ${post.slug}, status = ${post.status}, title = ${c.title},
            excerpt = ${c.excerpt}, head_text = ${c.searchText}, head_revision_id = ${post.headRevisionId},
            tags = ${post.tags as string[]}, align = ${post.align}, published_at = ${post.publishedAt},
            updated_at = ${post.updatedAt}, deleted_at = ${post.deletedAt}, purge_after = ${post.purgeAfter},
            version = version + 1
          WHERE id = ${post.id} AND version = ${post.version}`;
        this.expectUpdated(result.count, post);
      }
    } catch (error) {
      if (Database.isUniqueViolation(error, 'posts_space_id_slug_key'))
        throw new RuleViolation('이미 쓰는 주소예요 (휴지통 글 포함)');
      throw error;
    }
    const r = post.addedRevision;
    if (r)
      await this.sql`
        INSERT INTO blog.post_revisions (id, post_id, seq, title, body_md, base_revision_id, request_id,
          actor_type, actor_id, created_at)
        VALUES (${r.id}, ${post.id}, ${r.seq}, ${r.content.title}, ${r.content.body}, ${r.baseRevisionId},
          ${r.requestId}, ${r.actorType}, ${r.actorId}, ${r.createdAt})`;
    await this.publishEvents(post);
  }

  private select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT p.*, r.title AS head_title, r.body_md AS head_body,
             (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count
      FROM blog.posts p LEFT JOIN blog.post_revisions r ON r.id = p.head_revision_id
      WHERE p.id = ${id} AND p.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF p` : this.sql``}`;
  }
}
