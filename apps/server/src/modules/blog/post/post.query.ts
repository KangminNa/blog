import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database, NotFound, type Row } from '../../platform';
import { PostWikiQuery } from '../../vault';
import { Post } from './post';
import { ListPostsInput, type PostSlugInput, type ReadPostInput } from './post.input';
import { PostCountsView, PostPageView, PostSummaryView, PostView } from './post.view';

// 글 읽기. 방문자는 공개 글만 목록에 보이고, 링크만 글은 주소로만 열린다. 임시·휴지통 글은 없는 글과 같다.
// 비공개까지 볼 수 있는 요청자(주인, read_all 기기)는 전부 본다.
// 방문자는 공간을 모른다: MVP는 공간이 하나라 공간으로 거르지 않는다 (여럿이 되면 Guard가 주소로 공간을 정한다).
@Injectable()
export class PostQuery extends BaseQuery {
  private static readonly PAGE = 20;

  constructor(
    db: Database,
    private readonly wikis: PostWikiQuery,
  ) {
    super(db);
  }

  async list(actor: Actor, req: ListPostsInput): Promise<PostPageView> {
    const all = actor.canSeePrivate();
    // 주인은 고친 순서, 방문자는 발행한 순서
    const at = all ? this.sql`p.updated_at` : this.sql`p.published_at`;
    const rows = await this.sql`
      SELECT p.*, (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count
      FROM blog.posts p
      WHERE ${this.inSpace(actor)} ${this.filter(all, req.status)}
        ${req.before === null ? this.sql`` : this.sql`AND (${at}, p.id) < (${req.before[0]}, ${req.before[1]})`}
      ORDER BY ${at} DESC, p.id DESC
      LIMIT ${PostQuery.PAGE + 1}`;
    const page = rows.slice(0, PostQuery.PAGE).map((r) => this.summary(r));
    const last = page.at(-1);
    const lastAt = all ? last?.updatedAt : last?.publishedAt;
    return new PostPageView(
      page,
      rows.length > PostQuery.PAGE && last && lastAt
        ? ListPostsInput.cursorAfter(lastAt, last.id)
        : null,
      all ? await this.counts(actor) : null,
    );
  }

  /** 주소로 글 하나. 방문자는 공개·링크만 글, 주인은 임시 글도 (미리 보기) */
  async bySlug(actor: Actor, req: PostSlugInput): Promise<PostView> {
    const all = actor.canSeePrivate();
    const [row] = await this.sql`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.slug = ${req.slug} AND p.deleted_at IS NULL
        ${all ? this.sql`` : this.sql`AND p.status IN (${Post.PUBLISHED}, ${Post.UNLISTED})`}`;
    if (!row) throw new NotFound('글을 찾을 수 없어요');
    return this.view(row, all);
  }

  /** 편집기가 여는 글 하나 (휴지통 글 포함). 글을 쓸 수 있는 요청자만 */
  async get(actor: Actor, req: ReadPostInput): Promise<PostView> {
    actor.assertCan(Actor.WRITE);
    const [row] = await this.sql`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.id = ${req.id}`;
    if (!row) throw new NotFound('글을 찾을 수 없어요');
    return this.view(row, actor.canSeePrivate());
  }

  /** 고칠 수 있는 글 하나 (AI 도구의 읽기, 사진 올리기). 휴지통 글은 없는 글과 같다 */
  async editable(actor: Actor, req: ReadPostInput): Promise<PostView> {
    actor.assertCan(Actor.WRITE);
    const [row] = await this.sql`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.id = ${req.id} AND p.deleted_at IS NULL`;
    if (!row) throw new NotFound('글을 찾을 수 없어요');
    const all = actor.canSeePrivate();
    const seen = all ? null : await this.wikis.visible(actor, PostQuery.linksOf(row));
    return this.view(row, all, seen);
  }

  private async counts(actor: Actor): Promise<PostCountsView> {
    const [c] = await this.sql`
      SELECT count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.DRAFT})::int AS draft,
             count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.PUBLISHED})::int AS published,
             count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.UNLISTED})::int AS unlisted,
             count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trash
      FROM blog.posts p WHERE ${this.inSpace(actor)}`;
    return new PostCountsView(
      Number(c?.draft ?? 0),
      Number(c?.published ?? 0),
      Number(c?.unlisted ?? 0),
      Number(c?.trash ?? 0),
    );
  }

  /** 목록에서 볼 글: 방문자는 공개 글만, 주인은 고른 탭 (없으면 휴지통 말고 전부) */
  private filter(all: boolean, status: string | null) {
    if (!all) return this.sql`AND p.status = ${Post.PUBLISHED} AND p.deleted_at IS NULL`;
    if (status === ListPostsInput.TRASH) return this.sql`AND p.deleted_at IS NOT NULL`;
    if (status === null) return this.sql`AND p.deleted_at IS NULL`;
    return this.sql`AND p.status = ${status} AND p.deleted_at IS NULL`;
  }

  private inSpace(actor: Actor) {
    return actor.spaceId === null ? this.sql`TRUE` : this.sql`p.space_id = ${actor.spaceId}`;
  }

  private selectOne() {
    return this.sql`
      SELECT p.*, r.body_md AS head_body,
             (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count,
             (SELECT array_agg(x.wiki_id ORDER BY x.wiki_id)
              FROM blog.post_wiki_refs x WHERE x.post_id = p.id) AS ref_wiki_ids
      FROM blog.posts p LEFT JOIN blog.post_revisions r ON r.id = p.head_revision_id`;
  }

  /** seen: 비공개를 볼 수 없는 요청자에게 보여도 되는 wiki. 없으면 연결을 담지 않는다 */
  private view(r: Row, owner: boolean, seen: ReadonlySet<string> | null = null): PostView {
    const shown = (id: string) => owner || (seen?.has(id) ?? false);
    const main = r.main_wiki_id === null ? null : String(r.main_wiki_id);
    return new PostView(
      this.summary(r),
      String(r.head_body ?? ''),
      PostQuery.alignOf(r),
      owner,
      main !== null && shown(main) ? main : null,
      PostQuery.refsOf(r).filter(shown),
    );
  }

  /** DB의 CHECK가 Post.STATUSES만 받으니 그대로 좁힌다 */
  private static statusOf(r: Row): PostSummaryView['status'] {
    return String(r.status) as PostSummaryView['status'];
  }

  /** DB의 CHECK가 Post.ALIGNS만 받으니 그대로 좁힌다 */
  private static alignOf(r: Row): PostView['align'] {
    return String(r.align) as PostView['align'];
  }

  private static refsOf(r: Row): readonly string[] {
    return (r.ref_wiki_ids as string[] | null) ?? [];
  }

  private static linksOf(r: Row): readonly string[] {
    return [...(r.main_wiki_id === null ? [] : [String(r.main_wiki_id)]), ...PostQuery.refsOf(r)];
  }

  private summary(r: Row): PostSummaryView {
    return new PostSummaryView(
      String(r.id),
      String(r.slug),
      String(r.title ?? ''),
      String(r.excerpt ?? ''),
      PostQuery.statusOf(r),
      (r.tags as string[] | null) ?? [],
      Number(r.revision_count),
      r.published_at === null ? null : new Date(r.published_at),
      new Date(r.updated_at),
      r.deleted_at === null ? null : new Date(r.deleted_at),
      Number(r.version),
    );
  }
}
