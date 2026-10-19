import { BaseRequest, type RequestFields } from '../../platform';
import { SessionNote } from './session-note';

/**
 * 세션 저장 (MCP `save_session`). AI 도구가 보내는 모양 그대로 snake_case.
 * 인용(quotes)이 4,000자를 넘으면 400: AI가 핵심만 남겨 다시 보낸다.
 */
export class SaveSessionRequest extends BaseRequest {
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

  static from(raw: unknown): SaveSessionRequest {
    return BaseRequest.read(
      raw,
      (f) =>
        new SaveSessionRequest(
          f.uuid('request_id'),
          f.text('source_session_id', 200),
          f.text('tool', 40),
          f.optionalText('project', 100),
          f.text('title', 200),
          SaveSessionRequest.sections(f),
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
 * 저장 전 검사 (MCP `check_session`). save_session과 같은 노트 모양이지만 대화 id·도구 이름은 없어도 된다.
 * 대화 id를 모르는 도구(ChatGPT·Claude 앱)는 비워 보내고, 서버가 만들어 준 값을 같은 대화의 다음 저장에도 쓴다.
 */
export class CheckSessionRequest extends BaseRequest {
  private constructor(
    readonly sourceSessionId: string | null,
    readonly tool: string | null,
    readonly title: string,
    readonly sections: ReadonlyMap<string, string>,
    readonly tags: readonly string[],
  ) {
    super();
  }

  static from(raw: unknown): CheckSessionRequest {
    return BaseRequest.read(
      raw,
      (f) =>
        new CheckSessionRequest(
          f.optionalText('source_session_id', 200),
          f.optionalText('tool', 40),
          f.text('title', 200),
          SaveSessionRequest.sections(f),
          f.optionalTextList('tags', 20, 40) ?? [],
        ),
    );
  }
}
