import { BaseRequest, type RequestFields } from '../../platform';
import { Post } from './post';
import { PostContent } from './post-content';
import { SlugPolicy } from './slug.policy';

/** 주소의 글 id를 본문과 함께 읽는다 (본문이 객체가 아니면 그대로 두어 "객체여야 해요"로 알린다) */
function withId(id: string, body: unknown): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? { ...body, id } : body;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 대표 wiki 칸. 보내지 않으면 undefined(그대로), null이면 비우기 */
function mainWikiOf(f: RequestFields, raw: unknown, name: string): string | null | undefined {
  const value = (raw as Record<string, unknown> | null)?.[name];
  return value === undefined || value === null ? value : f.uuid(name);
}

/** 참고 wiki 칸. 보내지 않으면 undefined(그대로), []이면 비우기 */
function refWikisOf(f: RequestFields, name: string): readonly string[] | undefined {
  const ids = f.optionalTextList(name, Post.REFS_MAX, 36);
  if (ids === null) return undefined;
  for (const [i, id] of ids.entries())
    if (!UUID.test(id)) f.reject(`${name}.${i}`, 'UUID 형식이어야 해요');
  return ids.map((id) => id.toLowerCase());
}

/** 이번 저장으로 잇는 wiki들 (볼 수 있는지 확인할 값) */
function linkedWikis(
  main: string | null | undefined,
  refs: readonly string[] | undefined,
): readonly string[] {
  return [...(main ? [main] : []), ...(refs ?? [])];
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
    readonly mainWikiId: string | null | undefined,
    readonly refWikiIds: readonly string[] | undefined,
  ) {
    super();
  }

  get wikiIds(): readonly string[] {
    return linkedWikis(this.mainWikiId, this.refWikiIds);
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
          mainWikiOf(f, raw, 'mainWikiId'),
          refWikisOf(f, 'refWikiIds'),
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
    /** 보내지 않으면 지금 연결 그대로. 대표 null·참고 []는 비우기 */
    readonly mainWikiId: string | null | undefined,
    readonly refWikiIds: readonly string[] | undefined,
  ) {
    super();
  }

  get wikiIds(): readonly string[] {
    return linkedWikis(this.mainWikiId, this.refWikiIds);
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
          mainWikiOf(f, raw, 'mainWikiId'),
          refWikisOf(f, 'refWikiIds'),
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

/** 글 하나 (GET /api/posts/:id, MCP `blog_get_post`) */
export class ReadPostRequest extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): ReadPostRequest {
    return BaseRequest.read({ id }, (f) => new ReadPostRequest(f.uuid('id')));
  }

  static fromTool(raw: unknown): ReadPostRequest {
    return BaseRequest.read(raw, (f) => new ReadPostRequest(f.uuid('post_id')));
  }
}

/**
 * AI 도구의 초안 저장 (MCP `blog_save_draft`). post_id가 없으면 새 초안, 있으면 그 초안을 고친다.
 * 고칠 때는 base_version이 꼭 있어야 한다: 없으면 사람이 그사이 고친 내용을 AI가 모르고 덮을 수 있다.
 */
export class SaveDraftRequest extends BaseRequest {
  private static readonly REQUEST_ID_MAX = 200;

  private constructor(
    readonly requestId: string,
    readonly postId: string | null,
    readonly baseVersion: number | null,
    readonly title: string,
    readonly body: string,
    /** 없으면 고칠 때 지금 태그 그대로 */
    readonly tags: readonly string[] | null,
    /** 보내지 않으면 지금 연결 그대로. 대표 null·참고 []는 비우기 */
    readonly mainWikiId: string | null | undefined,
    readonly refWikiIds: readonly string[] | undefined,
  ) {
    super();
  }

  get wikiIds(): readonly string[] {
    return linkedWikis(this.mainWikiId, this.refWikiIds);
  }

  static from(raw: unknown): SaveDraftRequest {
    return BaseRequest.read(raw, (f) => {
      const editing = f.optionalText('post_id', 36) !== null;
      return new SaveDraftRequest(
        f.text('request_id', SaveDraftRequest.REQUEST_ID_MAX),
        editing ? f.uuid('post_id') : null,
        editing ? f.integer('base_version', 1, 2_147_483_647) : null,
        f.text('title', PostContent.TITLE_MAX),
        f.text('body_md', PostContent.BODY_MAX),
        f.optionalTextList('tags', Post.TAGS_MAX, Post.TAG_MAX),
        mainWikiOf(f, raw, 'main_wiki_id'),
        refWikisOf(f, 'ref_wiki_ids'),
      );
    });
  }
}

/** 주인이 승인한 공개: 일꾼이 꺼낸 task.approval.granted의 내용. blog는 task를 모르므로 값으로만 읽는다 */
export class ApprovedPublishRequest extends BaseRequest {
  private constructor(
    readonly approvalId: string,
    readonly action: string,
    readonly decidedBy: string,
    readonly postId: string,
    readonly targetVersion: number,
  ) {
    super();
  }

  static from(data: Readonly<Record<string, unknown>>): ApprovedPublishRequest {
    return BaseRequest.read(
      data,
      (f) =>
        new ApprovedPublishRequest(
          f.uuid('approvalId'),
          f.text('action', 100),
          f.uuid('decidedBy'),
          f.uuid('targetId'),
          f.integer('targetVersion', 0, 2_147_483_647),
        ),
    );
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
