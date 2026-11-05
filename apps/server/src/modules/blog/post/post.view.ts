// 글의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).
// 공개 범위(status)와 정렬(align)은 Post.STATUSES · Post.ALIGNS의 값이다 (DB의 CHECK가 지킨다).
// 보는 사람마다 모양이 달라서 방문자용은 toPublicJSON, 주인용은 toJSON이다.

/** 글 목록의 한 줄 */
export class PostSummaryView {
  constructor(
    readonly id: string,
    readonly slug: string,
    readonly title: string,
    readonly excerpt: string,
    readonly status: 'draft' | 'published' | 'unlisted',
    readonly tags: readonly string[],
    readonly revisionCount: number,
    readonly publishedAt: Date | null,
    readonly updatedAt: Date,
    readonly deletedAt: Date | null,
    /** 글 버전 (목록에서 바로 되살릴 때 보낸다) */
    readonly version: number,
  ) {}

  /** 방문자: 읽을 것만 */
  toPublicJSON() {
    return {
      slug: this.slug,
      title: this.title,
      excerpt: this.excerpt,
      tags: [...this.tags],
      publishedAt: this.publishedAt?.toISOString() ?? null,
    };
  }

  /** 주인: 공개 범위·판 수·버전까지 */
  toJSON() {
    return {
      ...this.toPublicJSON(),
      id: this.id,
      status: this.status,
      revisionCount: this.revisionCount,
      updatedAt: this.updatedAt.toISOString(),
      deletedAt: this.deletedAt?.toISOString() ?? null,
      version: this.version,
    };
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
    readonly posts: readonly PostSummaryView[],
    readonly next: string | null,
    readonly counts: PostCountsView | null,
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

/**
 * 글 하나: 목록 정보 + 본문. owner면 공개 범위·버전까지 보여준다.
 * wiki 연결에는 이 요청자가 볼 수 있는 wiki만 담는다: 진짜 id는 UUIDv7이라 비공개 wiki가 만들어진 때가 드러난다.
 */
export class PostView {
  constructor(
    readonly summary: PostSummaryView,
    readonly body: string,
    readonly align: 'left' | 'center',
    readonly owner: boolean,
    readonly mainWikiId: string | null,
    readonly refWikiIds: readonly string[],
  ) {}

  /** 방문자의 글 페이지. listed: 목록에 보이는 글인가 (링크만 글은 검색 엔진에도 알리지 않게 화면이 noindex를 단다) */
  toPublicJSON() {
    return {
      ...this.summary.toPublicJSON(),
      body: this.body,
      align: this.align,
      listed: this.summary.status === 'published',
    };
  }

  /** 주인의 미리 보기·편집기·결재: 공개 범위·버전과 wiki 연결까지 */
  toJSON() {
    return {
      ...this.toPublicJSON(),
      ...this.summary.toJSON(),
      mainWikiId: this.mainWikiId,
      refWikiIds: [...this.refWikiIds],
    };
  }
}

/** 쓰기 결과 (편집기에게). revised: 이번 저장으로 새 판이 쌓였는가 */
export class SavedPostView {
  constructor(
    readonly id: string,
    readonly slug: string,
    readonly title: string,
    readonly body: string,
    readonly excerpt: string,
    readonly tags: readonly string[],
    readonly align: 'left' | 'center',
    readonly status: 'draft' | 'published' | 'unlisted',
    readonly version: number,
    readonly revisionCount: number,
    readonly revised: boolean,
    readonly publishedAt: Date | null,
    readonly updatedAt: Date,
    readonly deletedAt: Date | null,
    readonly mainWikiId: string | null,
    readonly refWikiIds: readonly string[],
  ) {}

  /** wiki 연결 없이 (비공개까지 볼 수 없는 요청자: wiki id는 UUIDv7이라 만들어진 때가 드러난다) */
  toJSONWithoutWikis() {
    return {
      id: this.id,
      slug: this.slug,
      title: this.title,
      body: this.body,
      excerpt: this.excerpt,
      tags: [...this.tags],
      align: this.align,
      status: this.status,
      version: this.version,
      revisionCount: this.revisionCount,
      revised: this.revised,
      publishedAt: this.publishedAt?.toISOString() ?? null,
      updatedAt: this.updatedAt.toISOString(),
      deletedAt: this.deletedAt?.toISOString() ?? null,
    };
  }

  /** 비공개까지 보는 요청자 (주인의 편집기): wiki 연결까지 */
  toJSON() {
    return {
      ...this.toJSONWithoutWikis(),
      mainWikiId: this.mainWikiId,
      refWikiIds: [...this.refWikiIds],
    };
  }
}
