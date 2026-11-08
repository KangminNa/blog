import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database, NotFound } from '../../platform';
import { PostWikiQuery } from '../../vault';
import type { PostRow } from '../blog.tables';
import { type LoadedPost, Post } from './post';
import { ListPostsInput, type PostSlugInput, type ReadPostInput } from './post.input';
import {
  PostCountsView,
  PostPageView,
  PostSummaryView,
  PostView,
  PublicPostPageView,
  PublicPostSummaryView,
  PublicPostView,
  ToolPostView,
} from './post.view';

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

  /** 주인에게는 공개 범위·판 수·탭별 글 수까지, 그 밖에는 읽을 것만 */
  async list(actor: Actor, req: ListPostsInput): Promise<PostPageView | PublicPostPageView> {
    const all = actor.canSeePrivate();
    // 주인은 고친 순서, 방문자는 발행한 순서
    const at = all ? this.sql`p.updated_at` : this.sql`p.published_at`;
    const rows = await this.sql<(PostRow & { revision_count: number })[]>`
      SELECT p.*, (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count
      FROM blog.posts p
      WHERE ${this.inSpace(actor)} ${this.filter(all, req.status)}
        ${req.before === null ? this.sql`` : this.sql`AND (${at}, p.id) < (${req.before[0]}, ${req.before[1]})`}
      ORDER BY ${at} DESC, p.id DESC
      LIMIT ${PostQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, PostQuery.PAGE, (last) => {
      const lastAt = all ? last.updated_at : last.published_at;
      return lastAt ? ListPostsInput.cursorAfter(lastAt, last.id) : null;
    });
    return all
      ? new PostPageView(
          items.map((r) => new PostSummaryView(r, r.revision_count)),
          next,
          await this.counts(actor),
        )
      : new PublicPostPageView(
          items.map((r) => new PublicPostSummaryView(r)),
          next,
        );
  }

  /** 주소로 글 하나. 방문자는 공개·링크만 글, 주인은 임시 글도 (미리 보기) */
  async bySlug(actor: Actor, req: PostSlugInput): Promise<PostView | PublicPostView> {
    const all = actor.canSeePrivate();
    const [row] = await this.sql<LoadedPost[]>`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.slug = ${req.slug} AND p.deleted_at IS NULL
        ${all ? this.sql`` : this.sql`AND p.status IN (${Post.PUBLISHED}, ${Post.UNLISTED})`}`;
    return PostQuery.view(actor, PostQuery.found(row));
  }

  /** 편집기가 여는 글 하나 (휴지통 글 포함). 글을 쓸 수 있는 요청자만 */
  async get(actor: Actor, req: ReadPostInput): Promise<PostView | PublicPostView> {
    actor.assertCan(Actor.WRITE);
    const [row] = await this.sql<LoadedPost[]>`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.id = ${req.id}`;
    return PostQuery.view(actor, PostQuery.found(row));
  }

  /**
   * 고칠 수 있는 글 하나 (AI 도구의 읽기, 소재 담기, 사진 올리기). 휴지통 글은 없는 글과 같다.
   * 비공개를 볼 수 없는 요청자에게는 볼 수 있는 wiki만 잇는다
   */
  async editable(actor: Actor, req: ReadPostInput): Promise<ToolPostView> {
    actor.assertCan(Actor.WRITE);
    const [row] = await this.sql<LoadedPost[]>`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.id = ${req.id} AND p.deleted_at IS NULL`;
    const r = PostQuery.found(row);
    const main = r.main_wiki_id;
    const refs = r.ref_wiki_ids ?? [];
    const seen = actor.canSeePrivate()
      ? null
      : await this.wikis.visible(actor, [...(main === null ? [] : [main]), ...refs]);
    const shown = (id: string) => seen === null || seen.has(id);
    return new ToolPostView(
      r,
      r.head_body ?? '',
      main !== null && shown(main) ? main : null,
      refs.filter(shown),
    );
  }

  private async counts(actor: Actor): Promise<PostCountsView> {
    const [c] = await this.sql<
      { draft: number; published: number; unlisted: number; trash: number }[]
    >`
      SELECT count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.DRAFT})::int AS draft,
             count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.PUBLISHED})::int AS published,
             count(*) FILTER (WHERE deleted_at IS NULL AND status = ${Post.UNLISTED})::int AS unlisted,
             count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trash
      FROM blog.posts p WHERE ${this.inSpace(actor)}`;
    return new PostCountsView(c?.draft ?? 0, c?.published ?? 0, c?.unlisted ?? 0, c?.trash ?? 0);
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

  /** 글 한 줄과 지금 판, 판 수, 참고 wiki (PostRepository가 불러오는 것과 같은 모양) */
  private selectOne() {
    return this.sql`
      SELECT p.*, r.title AS head_title, r.body_md AS head_body,
             (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count,
             (SELECT array_agg(x.wiki_id ORDER BY x.wiki_id)
              FROM blog.post_wiki_refs x WHERE x.post_id = p.id) AS ref_wiki_ids
      FROM blog.posts p LEFT JOIN blog.post_revisions r ON r.id = p.head_revision_id`;
  }

  private static found(row: LoadedPost | undefined): LoadedPost {
    if (!row) throw new NotFound('글을 찾을 수 없어요');
    return row;
  }

  /** 제목은 찾기용 사본(posts.title)을 보여 준다. 주인에게는 공개 범위·버전과 wiki 연결까지 */
  private static view(actor: Actor, r: LoadedPost): PostView | PublicPostView {
    const body = r.head_body ?? '';
    return actor.canSeePrivate()
      ? new PostView(r, body, r.revision_count, r.ref_wiki_ids ?? [])
      : new PublicPostView(r, body);
  }
}
