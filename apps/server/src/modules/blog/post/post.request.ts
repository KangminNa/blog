import { BaseRequest } from '../../platform';
import { Post } from './post';
import { PostContent } from './post-content';
import { SlugPolicy } from './slug.policy';

/** 주소의 글 id를 본문과 함께 읽는다 (본문이 객체가 아니면 그대로 두어 "객체여야 해요"로 알린다) */
function withId(id: string, body: unknown): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? { ...body, id } : body;
}

/** 새 글 (POST /api/posts). requestId: 같은 요청이 두 번 와도 글은 하나 */
export class CreatePostRequest extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly title: string,
    readonly body: string,
    readonly tags: readonly string[],
    /** 사람이 정한 주소. 없으면 제목에서 만든다 */
    readonly slug: string | null,
    readonly align: string,
  ) {
    super();
  }

  static from(raw: unknown): CreatePostRequest {
    return BaseRequest.read(
      raw,
      (f) =>
        new CreatePostRequest(
          f.uuid('requestId'),
          f.text('title', PostContent.TITLE_MAX),
          f.optionalText('body', PostContent.BODY_MAX) ?? '',
          f.optionalTextList('tags', Post.TAGS_MAX, Post.TAG_MAX) ?? [],
          f.optionalText('slug', SlugPolicy.MAX),
          f.optionalText('align', 10) ?? 'left',
        ),
    );
  }
}

/** 고쳐 쓰기 (PUT /api/posts/:id). version: 불러올 때의 글 버전 */
export class SavePostRequest extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly title: string,
    readonly body: string,
    readonly tags: readonly string[],
    /** 바꿀 주소. 없으면 지금 주소 그대로 */
    readonly slug: string | null,
    readonly align: string,
  ) {
    super();
  }

  static from(id: string, raw: unknown): SavePostRequest {
    return BaseRequest.read(
      withId(id, raw),
      (f) =>
        new SavePostRequest(
          f.uuid('id'),
          f.integer('version', 1, 2_147_483_647),
          f.text('title', PostContent.TITLE_MAX),
          f.optionalText('body', PostContent.BODY_MAX) ?? '',
          f.optionalTextList('tags', Post.TAGS_MAX, Post.TAG_MAX) ?? [],
          f.optionalText('slug', SlugPolicy.MAX),
          f.optionalText('align', 10) ?? 'left',
        ),
    );
  }
}

/** 공개 범위 바꾸기 (POST /api/posts/:id/status) */
export class PostStatusRequest extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly status: string,
  ) {
    super();
  }

  static from(id: string, raw: unknown): PostStatusRequest {
    return BaseRequest.read(
      withId(id, raw),
      (f) =>
        new PostStatusRequest(
          f.uuid('id'),
          f.integer('version', 1, 2_147_483_647),
          f.text('status', 20),
        ),
    );
  }
}

/** 휴지통으로 보내기·되살리기 (DELETE /api/posts/:id, POST /api/posts/:id/restore) */
export class PostVersionRequest extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): PostVersionRequest {
    return BaseRequest.read(
      withId(id, raw),
      (f) => new PostVersionRequest(f.uuid('id'), f.integer('version', 1, 2_147_483_647)),
    );
  }
}

/** 글 목록 (GET /api/posts?status=&cursor=). status: draft · published · unlisted · trash, 없으면 휴지통 말고 전부 */
export class ListPostsRequest extends BaseRequest {
  static readonly TRASH = 'trash';
  private static readonly FILTERS = [...Post.STATUSES, ListPostsRequest.TRASH];
  private static readonly CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

  private constructor(
    readonly status: string | null,
    /** 이 시각·id보다 앞(더 오래된) 글부터 */
    readonly before: readonly [Date, string] | null,
  ) {
    super();
  }

  static from(query: unknown): ListPostsRequest {
    return BaseRequest.read(query, (f) => {
      const status = f.optionalText('status', 20);
      if (status !== null && !ListPostsRequest.FILTERS.includes(status))
        f.reject('status', `${ListPostsRequest.FILTERS.join(' · ')} 중 하나예요`);
      const cursor = f.optionalText('cursor', 200);
      const decoded = cursor ? Buffer.from(cursor, 'base64url').toString() : '';
      const match = ListPostsRequest.CURSOR.exec(decoded);
      if (cursor && !match) f.reject('cursor', '앞 쪽 응답의 next 값을 그대로 보내 주세요');
      return new ListPostsRequest(
        status,
        match?.[1] && match[2] ? [new Date(match[1]), match[2]] : null,
      );
    });
  }

  /** 다음 쪽을 부를 값: 이 쪽의 마지막 글 */
  static cursorAfter(at: Date, id: string): string {
    return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
  }
}

/** 글 하나 (GET /api/posts/:id) */
export class ReadPostRequest extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): ReadPostRequest {
    return BaseRequest.read({ id }, (f) => new ReadPostRequest(f.uuid('id')));
  }
}

/** 주소로 글 하나 (GET /api/posts/by-slug/:slug) */
export class PostSlugRequest extends BaseRequest {
  private constructor(readonly slug: string) {
    super();
  }

  static from(slug: string): PostSlugRequest {
    return BaseRequest.read(
      { slug },
      (f) => new PostSlugRequest(f.text('slug', SlugPolicy.MAX).normalize('NFC').toLowerCase()),
    );
  }
}
