import { BaseRequest, type RequestFields } from '../../platform';
import { SessionNote } from './session-note';
import { SessionTranscript } from './session-transcript';

/**
 * 세션 저장 (MCP `save_session`). AI 도구가 보내는 모양 그대로 snake_case.
 * 인용(quotes)이 4,000자를 넘으면 400: AI가 핵심만 남겨 다시 보낸다.
 */
export class SaveSessionInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly sourceSessionId: string,
    readonly tool: string,
    readonly project: string | null,
    readonly title: string,
    /** 칸 이름(did · decisions · blocked · quotes · extra) → 글 */
    readonly sections: ReadonlyMap<string, string>,
    readonly tags: readonly string[],
    readonly startedAt: Date | null,
  ) {
    super();
  }

  static from(raw: unknown): SaveSessionInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new SaveSessionInput(
          f.uuid('request_id'),
          f.text('source_session_id', 200),
          f.text('tool', 40),
          f.optionalText('project', 100),
          f.text('title', 200),
          SaveSessionInput.sections(f),
          f.optionalTextList('tags', 20, 40) ?? [],
          f.optionalDate('started_at'),
        ),
    );
  }

  /** 고정 칸 다섯 (빈 칸은 빈 글자). 저장과 검사가 같은 규칙으로 읽는다 */
  static sections(f: RequestFields): ReadonlyMap<string, string> {
    return new Map(
      SessionNote.SECTIONS.map(([name]) => [
        name,
        f.optionalText(
          name,
          name === 'quotes' ? SessionNote.QUOTES_MAX : SessionNote.SECTION_MAX,
        ) ?? '',
      ]),
    );
  }
}

/**
 * 원문 올리기 (MCP `save_transcript`, 2차 4단계). 수집 훅 · 확장이 대화 원문을 보낸다 (내 컴퓨터에서 민감정보를 지운 것).
 * 같은 기기 · 도구 · 대화 id는 같은 세션이다. 제목은 노트가 오기 전에 보일 이름
 */
export class SaveTranscriptInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly tool: string,
    readonly sourceSessionId: string,
    readonly project: string | null,
    readonly title: string | null,
    readonly startedAt: Date | null,
    readonly text: string,
  ) {
    super();
  }

  static from(raw: unknown): SaveTranscriptInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new SaveTranscriptInput(
          f.uuid('request_id'),
          f.text('tool', 40),
          f.text('source_session_id', 200),
          f.optionalText('project', 100),
          f.optionalText('title', SessionNote.TITLE_MAX),
          f.optionalDate('started_at'),
          f.text('text', SessionTranscript.MAX),
        ),
    );
  }
}

/** 서버 러너의 세션 노트 일 (MCP `read_transcript` · `save_note`): 러너가 쥔 일의 id, 노트면 AI의 답 */
export class NoteWorkInput extends BaseRequest {
  private static readonly ANSWER_MAX = 200_000;

  private constructor(
    readonly taskId: string,
    /** AI의 답 (지시문 틀 session-note의 JSON). 읽기에는 없다 */
    readonly answer: string,
  ) {
    super();
  }

  static from(raw: unknown): NoteWorkInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new NoteWorkInput(
          f.uuid('task_id'),
          f.optionalText('answer', NoteWorkInput.ANSWER_MAX) ?? '',
        ),
    );
  }
}

/**
 * 저장 전 검사 (MCP `check_session`). save_session과 같은 노트 모양이지만 대화 id·도구 이름은 없어도 된다.
 * 대화 id를 모르는 도구(ChatGPT·Claude 앱)는 비워 보내고, 서버가 만들어 준 값을 같은 대화의 다음 저장에도 쓴다.
 */
export class CheckSessionInput extends BaseRequest {
  private constructor(
    readonly sourceSessionId: string | null,
    readonly tool: string | null,
    readonly title: string,
    readonly sections: ReadonlyMap<string, string>,
    readonly tags: readonly string[],
  ) {
    super();
  }

  static from(raw: unknown): CheckSessionInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new CheckSessionInput(
          f.optionalText('source_session_id', 200),
          f.optionalText('tool', 40),
          f.text('title', 200),
          SaveSessionInput.sections(f),
          f.optionalTextList('tags', 20, 40) ?? [],
        ),
    );
  }
}

/** 세션 목록 (GET /api/sessions?project=&cursor=). cursor는 앞 쪽 응답의 next 그대로 */
export class ListSessionsInput extends BaseRequest {
  private static readonly CURSOR = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

  private constructor(
    readonly project: string | null,
    /** 이 시각·id보다 앞(더 오래된) 세션부터 */
    readonly before: readonly [Date, string] | null,
  ) {
    super();
  }

  static from(query: unknown): ListSessionsInput {
    return BaseRequest.read(query, (f) => {
      const cursor = f.optionalText('cursor', 200);
      const decoded = cursor ? Buffer.from(cursor, 'base64url').toString() : '';
      const match = ListSessionsInput.CURSOR.exec(decoded);
      if (cursor && !match) f.reject('cursor', '앞 쪽 응답의 next 값을 그대로 보내 주세요');
      return new ListSessionsInput(
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
export class SearchSessionsInput extends BaseRequest {
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

  static from(raw: unknown): SearchSessionsInput {
    return BaseRequest.read(raw, (f) => {
      const query = f.text('query', SearchSessionsInput.QUERY_MAX);
      const words = query.split(/\s+/).filter(Boolean);
      if (query && words.length === 0) f.reject('query', '찾을 말을 써 주세요');
      const cursor = f.optionalText('cursor', 100);
      const before = cursor ? Buffer.from(cursor, 'base64url').toString() : null;
      if (before !== null && !SearchSessionsInput.SESSION_ID.test(before))
        f.reject('cursor', '앞 응답의 next 값을 그대로 보내 주세요');
      return new SearchSessionsInput(
        words,
        f.optionalText('project', 100),
        f.optionalText('tool', 40),
        f.optionalDate('from'),
        f.optionalDate('to'),
        SearchSessionsInput.limit(raw, f),
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
      ? SearchSessionsInput.LIMIT_DEFAULT
      : f.integer('limit', 1, SearchSessionsInput.LIMIT_MAX);
  }
}

/** 세션 하나의 지금 판 (MCP `get_session`). save_session이 돌려준 session_id를 그대로 받는다 */
export class GetSessionInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(raw: unknown): GetSessionInput {
    return BaseRequest.read(raw, (f) => new GetSessionInput(f.uuid('session_id')));
  }
}

/** 세션 하나 또는 그 판 하나 (GET /api/sessions/:id, /api/sessions/:id/revisions/:seq) */
export class ReadSessionInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly seq: number | null,
  ) {
    super();
  }

  static from(params: unknown): ReadSessionInput {
    return BaseRequest.read(params, (f) => {
      const seq = f.optionalText('seq', 9);
      if (seq !== null && !/^[1-9]\d*$/.test(seq)) f.reject('seq', '1 이상의 버전 번호여야 해요');
      return new ReadSessionInput(f.uuid('id'), seq === null ? null : Number(seq));
    });
  }
}
