import { BaseResponse } from '../../platform';
import { Post } from './post';
import type { PostPageView, PostSummaryView, PostView } from './post.query';

/** 글 목록 한 쪽. 방문자에게는 읽을 것만, 주인에게는 공개 범위·판 수·탭별 글 수까지 */
export class PostListResponse extends BaseResponse {
  private constructor(private readonly page: PostPageView) {
    super();
  }

  static of(page: PostPageView): PostListResponse {
    return new PostListResponse(page);
  }

  toJSON(): object {
    const owner = this.page.counts !== null;
    return {
      posts: this.page.posts.map((p) => (owner ? ownerSummary(p) : visitorSummary(p))),
      next: this.page.next,
      ...(owner ? { counts: this.page.counts } : {}),
    };
  }
}

/** 글 하나 (방문자의 글 페이지, 주인의 미리 보기·편집기) */
export class PostResponse extends BaseResponse {
  private constructor(private readonly view: PostView) {
    super();
  }

  static of(view: PostView): PostResponse {
    return new PostResponse(view);
  }

  toJSON(): object {
    const v = this.view;
    // listed: 목록에 보이는 글인가 (링크만 글은 검색 엔진에도 알리지 않게 화면이 noindex를 단다)
    const base = {
      ...visitorSummary(v.summary),
      body: v.body,
      align: v.align,
      listed: v.summary.status === Post.PUBLISHED,
    };
    return v.owner ? { ...base, ...ownerSummary(v.summary) } : base;
  }
}

/** 쓰기 결과 (편집기에게). revised: 이번 저장으로 새 판이 쌓였는가 */
export class PostSavedResponse extends BaseResponse {
  private constructor(private readonly post: Post) {
    super();
  }

  static of(post: Post): PostSavedResponse {
    return new PostSavedResponse(post);
  }

  toJSON(): object {
    const p = this.post;
    return {
      id: p.id,
      slug: p.slug,
      title: p.content.title,
      body: p.content.body,
      excerpt: p.content.excerpt,
      tags: p.tags,
      align: p.align,
      status: p.status,
      version: p.version,
      revisionCount: p.revisionCount,
      revised: p.addedRevision !== null,
      publishedAt: p.publishedAt,
      updatedAt: p.updatedAt,
      deletedAt: p.deletedAt,
    };
  }
}

function visitorSummary(p: PostSummaryView): object {
  return {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    tags: p.tags,
    publishedAt: p.publishedAt,
  };
}

function ownerSummary(p: PostSummaryView): object {
  return {
    ...visitorSummary(p),
    id: p.id,
    status: p.status,
    revisionCount: p.revisionCount,
    updatedAt: p.updatedAt,
    deletedAt: p.deletedAt,
    version: p.version,
  };
}
