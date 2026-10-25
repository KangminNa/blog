import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, NotFound, type Row } from '../../platform';
import { Post } from './post';
import { ListPostsRequest, type PostSlugRequest, type ReadPostRequest } from './post.request';

/** 글 목록의 한 줄 */
export class PostSummaryView {
  constructor(
    readonly id: string,
    readonly slug: string,
    readonly title: string,
    readonly excerpt: string,
    readonly status: string,
    readonly tags: readonly string[],
    readonly revisionCount: number,
    readonly publishedAt: Date | null,
    readonly updatedAt: Date,
    readonly deletedAt: Date | null,
    /** 글 버전 (목록에서 바로 되살릴 때 보낸다) */
    readonly version: number,
  ) {}
}

/** 관리 화면 탭의 글 수 */
export class PostCountsView {
  constructor(
    readonly draft: number,
    readonly published: number,
    readonly unlisted: number,
    readonly trash: number,
  ) {}
}

/** 목록 한 쪽. counts는 비공개 글까지 보는 사람(주인)에게만 */
export class PostPageView {
  constructor(
    readonly posts: readonly PostSummaryView[],
    readonly next: string | null,
    readonly counts: PostCountsView | null,
  ) {}
}

/** 글 하나: 목록 정보 + 본문. owner면 공개 범위·버전까지 보여준다 */
export class PostView {
  constructor(
    readonly summary: PostSummaryView,
    readonly body: string,
    readonly align: string,
    readonly owner: boolean,
  ) {}
}

// 글 읽기. 방문자는 공개 글만 목록에 보이고, 링크만 글은 주소로만 열린다. 임시·휴지통 글은 없는 글과 같다.
// 비공개까지 볼 수 있는 요청자(주인, read_all 기기)는 전부 본다.
// 방문자는 공간을 모른다: MVP는 공간이 하나라 공간으로 거르지 않는다 (여럿이 되면 Guard가 주소로 공간을 정한다).
@Injectable()
export class PostQuery extends BaseQuery {
  private static readonly PAGE = 20;

  async list(actor: Actor, req: ListPostsRequest): Promise<PostPageView> {
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
        ? ListPostsRequest.cursorAfter(lastAt, last.id)
        : null,
      all ? await this.counts(actor) : null,
    );
  }

  /** 주소로 글 하나. 방문자는 공개·링크만 글, 주인은 임시 글도 (미리 보기) */
  async bySlug(actor: Actor, req: PostSlugRequest): Promise<PostView> {
    const all = actor.canSeePrivate();
    const [row] = await this.sql`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.slug = ${req.slug} AND p.deleted_at IS NULL
        ${all ? this.sql`` : this.sql`AND p.status IN (${Post.PUBLISHED}, ${Post.UNLISTED})`}`;
    if (!row) throw new NotFound('글을 찾을 수 없어요');
    return this.view(row, all);
  }

  /** 편집기가 여는 글 하나 (휴지통 글 포함). 글을 쓸 수 있는 요청자만 */
  async get(actor: Actor, req: ReadPostRequest): Promise<PostView> {
    actor.assertCan(Actor.WRITE);
    const [row] = await this.sql`
      ${this.selectOne()}
      WHERE ${this.inSpace(actor)} AND p.id = ${req.id}`;
    if (!row) throw new NotFound('글을 찾을 수 없어요');
    return this.view(row, actor.canSeePrivate());
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
    if (status === ListPostsRequest.TRASH) return this.sql`AND p.deleted_at IS NOT NULL`;
    if (status === null) return this.sql`AND p.deleted_at IS NULL`;
    return this.sql`AND p.status = ${status} AND p.deleted_at IS NULL`;
  }

  private inSpace(actor: Actor) {
    return actor.spaceId === null ? this.sql`TRUE` : this.sql`p.space_id = ${actor.spaceId}`;
  }

  private selectOne() {
    return this.sql`
      SELECT p.*, r.body_md AS head_body,
             (SELECT count(*) FROM blog.post_revisions x WHERE x.post_id = p.id)::int AS revision_count
      FROM blog.posts p LEFT JOIN blog.post_revisions r ON r.id = p.head_revision_id`;
  }

  private view(r: Row, owner: boolean): PostView {
    return new PostView(this.summary(r), String(r.head_body ?? ''), String(r.align), owner);
  }

  private summary(r: Row): PostSummaryView {
    return new PostSummaryView(
      String(r.id),
      String(r.slug),
      String(r.title ?? ''),
      String(r.excerpt ?? ''),
      String(r.status),
      (r.tags as string[] | null) ?? [],
      Number(r.revision_count),
      r.published_at === null ? null : new Date(r.published_at),
      new Date(r.updated_at),
      r.deleted_at === null ? null : new Date(r.deleted_at),
      Number(r.version),
    );
  }
}
