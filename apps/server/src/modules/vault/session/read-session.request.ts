import { BaseRequest } from '../../platform';

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
