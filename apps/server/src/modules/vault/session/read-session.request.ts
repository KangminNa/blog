import { BaseRequest, type RequestFields } from '../../platform';

/** 세션 목록 (GET /api/sessions?project=&cursor=). cursor는 앞 쪽 응답의 next 그대로 */
export class ListSessionsRequest extends BaseRequest {
  private static readonly CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

  private constructor(
    readonly project: string | null,
    /** 이 시각·id보다 앞(더 오래된) 세션부터 */
    readonly before: readonly [Date, string] | null,
  ) {
    super();
  }

  static from(query: unknown): ListSessionsRequest {
    return BaseRequest.read(query, (f) => {
      const cursor = f.optionalText('cursor', 200);
      const decoded = cursor ? Buffer.from(cursor, 'base64url').toString() : '';
      const match = ListSessionsRequest.CURSOR.exec(decoded);
      if (cursor && !match) f.reject('cursor', '앞 쪽 응답의 next 값을 그대로 보내 주세요');
      return new ListSessionsRequest(
        f.optionalText('project', 100),
        match?.[1] && match[2] ? [new Date(match[1]), match[2]] : null,
      );
    });
  }

  /** 다음 쪽을 부를 값: 이 쪽의 마지막 세션 */
  static cursorAfter(lastRevisionAt: Date, id: string): string {
    return Buffer.from(`${lastRevisionAt.toISOString()}|${id}`).toString('base64url');
  }
}

/**
 * 세션 찾기 (MCP `search_sessions`). 띄어 쓴 단어는 모두 들어 있어야 찾는다.
 * cursor는 앞 응답의 next 그대로. 자리만 담고 있어서 서버가 그 세션을 다시 찾아보지 않는다.
 */
export class SearchSessionsRequest extends BaseRequest {
  static readonly QUERY_MAX = 200;
  static readonly LIMIT_DEFAULT = 10;
  static readonly LIMIT_MAX = 30;
  private static readonly SESSION_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  private constructor(
    readonly words: readonly string[],
    readonly project: string | null,
    readonly tool: string | null,
    readonly from: Date | null,
    readonly to: Date | null,
    readonly limit: number,
    /** 이 세션보다 먼저 저장된 세션부터 */
    readonly before: string | null,
  ) {
    super();
  }

  static from(raw: unknown): SearchSessionsRequest {
    return BaseRequest.read(raw, (f) => {
      const query = f.text('query', SearchSessionsRequest.QUERY_MAX);
      const words = query.split(/\s+/).filter(Boolean);
      if (query && words.length === 0) f.reject('query', '찾을 말을 써 주세요');
      const cursor = f.optionalText('cursor', 100);
      const before = cursor ? Buffer.from(cursor, 'base64url').toString() : null;
      if (before !== null && !SearchSessionsRequest.SESSION_ID.test(before))
        f.reject('cursor', '앞 응답의 next 값을 그대로 보내 주세요');
      return new SearchSessionsRequest(
        words,
        f.optionalText('project', 100),
        f.optionalText('tool', 40),
        f.optionalDate('from'),
        f.optionalDate('to'),
        SearchSessionsRequest.limit(raw, f),
        before,
      );
    });
  }

  /** 다음 쪽을 부를 값: 이 쪽의 마지막 세션 */
  static cursorAfter(id: string): string {
    return Buffer.from(id).toString('base64url');
  }

  /** 없으면 기본값, 있으면 정수인지 본다 (없어도 되는 정수를 읽는 칸은 이것뿐이다) */
  private static limit(raw: unknown, f: RequestFields): number {
    const given = (raw as Readonly<Record<string, unknown>> | null)?.limit;
    return given === undefined || given === null
      ? SearchSessionsRequest.LIMIT_DEFAULT
      : f.integer('limit', 1, SearchSessionsRequest.LIMIT_MAX);
  }
}

/** 세션 하나의 지금 판 (MCP `get_session`). save_session이 돌려준 session_id를 그대로 받는다 */
export class GetSessionRequest extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(raw: unknown): GetSessionRequest {
    return BaseRequest.read(raw, (f) => new GetSessionRequest(f.uuid('session_id')));
  }
}

/** 세션 하나 또는 그 판 하나 (GET /api/sessions/:id, /api/sessions/:id/revisions/:seq) */
export class ReadSessionRequest extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly seq: number | null,
  ) {
    super();
  }

  static from(params: unknown): ReadSessionRequest {
    return BaseRequest.read(params, (f) => {
      const seq = f.optionalText('seq', 9);
      if (seq !== null && !/^[1-9]\d*$/.test(seq)) f.reject('seq', '1 이상의 판 번호여야 해요');
      return new ReadSessionRequest(f.uuid('id'), seq === null ? null : Number(seq));
    });
  }
}
