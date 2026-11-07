import type { PostRow } from '../blog.tables';

// 글의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.
// 보는 사람마다 모양이 달라서 비공개를 볼 수 없는 요청자(방문자)용은 toPublicJSON, 주인용은 toJSON이다.

/** 공개 범위. DB의 CHECK가 Post.STATUSES만 받으니 그대로 좁힌다 */
function statusOf(r: Readonly<PostRow>) {
  return r.status as 'draft' | 'published' | 'unlisted';
}

/** 정렬. DB의 CHECK가 Post.ALIGNS만 받으니 그대로 좁힌다 */
function alignOf(r: Readonly<PostRow>) {
  return r.align as 'left' | 'center';
}

/** 누구에게나 보이는 칸 */
function publicColumns(r: Readonly<PostRow>) {
  return {
    slug: r.slug,
    title: r.title ?? '',
    excerpt: r.excerpt ?? '',
    tags: [...r.tags],
    publishedAt: r.published_at?.toISOString() ?? null,
  };
}

/** 주인에게 더 보이는 칸: 공개 범위, 판 수, 글 버전 (목록에서 바로 되살릴 때 보낸다) */
function ownerColumns(r: Readonly<PostRow>, revisionCount: number) {
  return {
    id: r.id,
    status: statusOf(r),
    revisionCount,
    updatedAt: r.updated_at.toISOString(),
    deletedAt: r.deleted_at?.toISOString() ?? null,
    version: r.version,
  };
}

/** 글 목록의 한 줄 */
export class PostSummaryView {
  constructor(
    private readonly row: Readonly<PostRow>,
    private readonly revisionCount: number,
  ) {}

  /** 방문자: 읽을 것만 */
  toPublicJSON() {
    return publicColumns(this.row);
  }

  /** 주인: 공개 범위·판 수·버전까지 */
  toJSON() {
    return { ...publicColumns(this.row), ...ownerColumns(this.row, this.revisionCount) };
  }
}

/** 관리 화면 탭의 글 수 */
export class PostCountsView {
  constructor(
    private readonly draft: number,
    private readonly published: number,
    private readonly unlisted: number,
    private readonly trash: number,
  ) {}

  toJSON() {
    return {
      draft: this.draft,
      published: this.published,
      unlisted: this.unlisted,
      trash: this.trash,
    };
  }
}

/** 목록 한 쪽. counts는 비공개 글까지 보는 사람(주인)에게만 */
export class PostPageView {
  constructor(
    private readonly posts: readonly PostSummaryView[],
    private readonly next: string | null,
    private readonly counts: PostCountsView | null,
  ) {}

  /** 방문자: 읽을 것만 */
  toPublicJSON() {
    return { posts: this.posts.map((p) => p.toPublicJSON()), next: this.next };
  }

  /** 주인: 공개 범위·판 수와 탭별 글 수까지 */
  toJSON() {
    return {
      posts: this.posts.map((p) => p.toJSON()),
      next: this.next,
      counts: this.counts?.toJSON(),
    };
  }
}

/** 글 하나: 목록 정보 + 본문 (방문자의 글 페이지, 주인의 미리 보기·편집기·결재) */
export class PostView {
  constructor(
    private readonly row: Readonly<PostRow>,
    private readonly body: string,
    private readonly revisionCount: number,
    private readonly refWikiIds: readonly string[],
  ) {}

  /** 방문자의 글 페이지. listed: 목록에 보이는 글인가 (링크만 글은 검색 엔진에도 알리지 않게 화면이 noindex를 단다) */
  toPublicJSON() {
    return {
      ...publicColumns(this.row),
      body: this.body,
      align: alignOf(this.row),
      listed: this.row.status === 'published',
    };
  }

  /** 주인의 미리 보기·편집기·결재: 공개 범위·버전과 wiki 연결까지 */
  toJSON() {
    return {
      ...this.toPublicJSON(),
      ...ownerColumns(this.row, this.revisionCount),
      mainWikiId: this.row.main_wiki_id,
      refWikiIds: [...this.refWikiIds],
    };
  }
}

/** 쓰기 결과 (편집기에게). revised: 이번 저장으로 새 판이 쌓였는가 */
export class SavedPostView {
  constructor(
    private readonly row: Readonly<PostRow>,
    private readonly body: string,
    private readonly revisionCount: number,
    private readonly revised: boolean,
    private readonly refWikiIds: readonly string[],
  ) {}

  /** wiki 연결 없이 (비공개까지 볼 수 없는 요청자: wiki id는 UUIDv7이라 만들어진 때가 드러난다) */
  toPublicJSON() {
    const r = this.row;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title ?? '',
      body: this.body,
      excerpt: r.excerpt ?? '',
      tags: [...r.tags],
      align: alignOf(r),
      status: statusOf(r),
      version: r.version,
      revisionCount: this.revisionCount,
      revised: this.revised,
      publishedAt: r.published_at?.toISOString() ?? null,
      updatedAt: r.updated_at.toISOString(),
      deletedAt: r.deleted_at?.toISOString() ?? null,
    };
  }

  /** 비공개까지 보는 요청자 (주인의 편집기): wiki 연결까지 */
  toJSON() {
    return {
      ...this.toPublicJSON(),
      mainWikiId: this.row.main_wiki_id,
      refWikiIds: [...this.refWikiIds],
    };
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
