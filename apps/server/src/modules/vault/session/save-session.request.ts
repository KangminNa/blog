import { BaseRequest } from '../../platform';
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
          new Map(
            SessionNote.SECTIONS.map(([name]) => [
              name,
              f.optionalText(
                name,
                name === 'quotes' ? SessionNote.QUOTES_MAX : SessionNote.SECTION_MAX,
              ) ?? '',
            ]),
          ),
          f.optionalTextList('tags', 20, 40) ?? [],
          f.optionalDate('started_at'),
        ),
    );
  }
}
