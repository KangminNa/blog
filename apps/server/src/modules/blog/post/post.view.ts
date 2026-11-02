import type { PostRow } from '../blog.tables';

// 글의 읽기 모양. 방문자와 주인이 보는 칸이 달라 View를 나눈다.
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다 (객체설계 6장).

/** 누구에게나 보이는 칸 */
function everyoneColumns(r: Readonly<PostRow>) {
  return {
    slug: r.slug,
    title: r.title ?? '',
    excerpt: r.excerpt ?? '',
    tags: r.tags,
    publishedAt: r.published_at?.toISOString() ?? null,
  };
}

/** 주인에게만 보이는 칸까지: 공개 범위, 판 수, 글 버전 (목록에서 바로 되살릴 때 보낸다) */
function ownerColumns(r: Readonly<PostRow>, revisionCount: number) {
  return {
    ...everyoneColumns(r),
    id: r.id,
    status: r.status,
    revisionCount,
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at?.toISOString() ?? null,
    version: r.version,
  };
}

/** 방문자가 보는 글 목록의 한 줄: 읽을 것만 */
export class PostItemView {
  constructor(protected readonly row: Readonly<PostRow>) {}

  toJSON() {
    return everyoneColumns(this.row);
  }
}

/** 주인이 보는 글 목록의 한 줄 */
export class OwnerPostItemView extends PostItemView {
  constructor(
    row: Readonly<PostRow>,
    private readonly revisionCount: number,
  ) {
    super(row);
  }

  override toJSON() {
    return ownerColumns(this.row, this.revisionCount);
  }
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
    private readonly posts: readonly PostItemView[],
    private readonly next: string | null,
    private readonly counts: PostCountsView | null,
  ) {}

  toJSON() {
    return {
      posts: this.posts.map((p) => p.toJSON()),
      next: this.next,
      ...(this.counts === null ? {} : { counts: this.counts }),
    };
  }
}

/** 방문자가 보는 글 하나. listed: 목록에 보이는 글인가 (링크만 글은 검색 엔진에도 알리지 않게 화면이 noindex를 단다) */
export class PostView {
  constructor(
    protected readonly row: Readonly<PostRow>,
    private readonly body: string,
    private readonly listed: boolean,
  ) {}

  toJSON() {
    return {
      ...everyoneColumns(this.row),
      body: this.body,
      align: this.row.align,
      listed: this.listed,
    };
  }
}

/** 주인이 보는 글 하나 (미리 보기, 편집기): 공개 범위·버전과 wiki 연결까지 */
export class OwnerPostView extends PostView {
  constructor(
    row: Readonly<PostRow>,
    body: string,
    listed: boolean,
    private readonly revisionCount: number,
    private readonly refWikiIds: readonly string[],
  ) {
    super(row, body, listed);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      ...ownerColumns(this.row, this.revisionCount),
      mainWikiId: this.row.main_wiki_id,
      refWikiIds: this.refWikiIds,
    };
  }
}

/** 쓰기 결과 (편집기에게). revised: 이번 저장으로 새 판이 쌓였는가 */
export class PostSavedView {
  constructor(
    protected readonly row: Readonly<PostRow>,
    private readonly body: string,
    private readonly revisionCount: number,
    private readonly revised: boolean,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      body: this.body,
      excerpt: r.excerpt,
      tags: r.tags,
      align: r.align,
      status: r.status,
      version: r.version,
      revisionCount: this.revisionCount,
      revised: this.revised,
      publishedAt: r.published_at?.toISOString() ?? null,
      updatedAt: r.updated_at.toISOString(),
      deletedAt: r.deleted_at?.toISOString() ?? null,
    };
  }
}

/** 비공개까지 보는 요청자의 쓰기 결과: wiki 연결까지 */
export class OwnerPostSavedView extends PostSavedView {
  constructor(
    row: Readonly<PostRow>,
    body: string,
    revisionCount: number,
    revised: boolean,
    private readonly refWikiIds: readonly string[],
  ) {
    super(row, body, revisionCount, revised);
  }

  override toJSON() {
    return { ...super.toJSON(), mainWikiId: this.row.main_wiki_id, refWikiIds: this.refWikiIds };
  }
}

/**
 * blog_get_post의 답. MCP는 snake_case.
 * wiki 연결에는 이 요청자가 볼 수 있는 wiki만 담는다: 진짜 id는 UUIDv7이라 비공개 wiki가 만들어진 때가 드러난다.
 */
export class ToolPostView {
  constructor(
    private readonly row: Readonly<PostRow>,
    private readonly body: string,
    private readonly mainWikiId: string | null,
    private readonly refWikiIds: readonly string[],
  ) {}

  /** 소재에 담을 때의 제목 */
  get title(): string {
    return this.row.title ?? '';
  }

  toJSON() {
    const r = this.row;
    return {
      post_id: r.id,
      title: this.title,
      body_md: this.body,
      status: r.status,
      version: r.version,
      tags: r.tags,
      main_wiki_id: this.mainWikiId,
      ref_wiki_ids: this.refWikiIds,
    };
  }
}

/** blog_save_draft의 답. url은 주인이 초안을 여는 편집기 주소 (초안은 방문자에게 보이지 않는다) */
export class ToolDraftView {
  constructor(
    private readonly row: Readonly<PostRow>,
    private readonly site: string,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      post_id: r.id,
      version: r.version,
      status: r.status,
      url: `${this.site}/admin/posts/${r.id}`,
    };
  }
}
