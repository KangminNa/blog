import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { SaveSessionRequest } from './save-session.request';
import { SaveSessionResponse } from './session.response';
import { SessionService } from './session.service';
import { SessionNote } from './session-note';

// MCP 도구 save_session: AI 도구가 작업한 세션의 노트를 저장한다. mcp 모듈이 모아서 연다.
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 cairn-save 스킬도 함께 고친다.
@Injectable()
export class SaveSessionTool extends BaseTool {
  readonly name = 'save_session';
  readonly scope = Actor.UPLOAD;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly description = [
    '방금 함께 작업한 AI 세션의 노트를 Cairn 블로그에 저장한다.',
    '먼저 check_session으로 검사하고, 받은 request_id와 source_session_id를 그대로 쓴다. 사용자에게 노트와 올릴 곳을 보여 주고 확인받은 뒤에 부른다.',
    '같은 대화(source_session_id)를 다시 저장하면 같은 세션에 새 판으로 쌓인다. 내용이 같으면 판을 만들지 않는다(unchanged).',
    '토큰·키·비밀번호는 보내기 전에 지운다. 서버도 한 번 더 지우고 warnings로 알려 준다.',
    '공개 여부는 정할 수 없다 (늘 비공개로 저장된다). 응답의 url을 사용자에게 보여 준다.',
  ].join(' ');
  /** 노트 모양. 저장(save_session)과 검사(check_session)가 같이 쓴다 */
  static readonly NOTE_PROPERTIES: Readonly<Record<string, unknown>> = {
    source_session_id: {
      type: 'string',
      maxLength: 200,
      description: 'AI 도구 안의 대화 id. 같은 대화는 늘 같은 값',
    },
    tool: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9-]{0,39}$',
      description: 'AI 도구 이름 (예: claude-code, codex)',
    },
    project: { type: 'string', maxLength: 100, description: '작업한 프로젝트 (예: 저장소 이름)' },
    title: { type: 'string', maxLength: 200, description: '세션 제목. 한 일을 한 줄로' },
    did: { type: 'string', maxLength: SessionNote.SECTION_MAX, description: '한 일' },
    decisions: {
      type: 'string',
      maxLength: SessionNote.SECTION_MAX,
      description: '결정한 것과 이유',
    },
    blocked: {
      type: 'string',
      maxLength: SessionNote.SECTION_MAX,
      description: '막힌 점, 남은 문제',
    },
    quotes: {
      type: 'string',
      maxLength: SessionNote.QUOTES_MAX,
      description: `핵심 원문 인용 (${SessionNote.QUOTES_MAX.toLocaleString('en-US')}자까지)`,
    },
    extra: { type: 'string', maxLength: SessionNote.SECTION_MAX, description: '기타' },
    tags: {
      type: 'array',
      items: { type: 'string', maxLength: 40 },
      maxItems: 20,
      description: '태그',
    },
    started_at: {
      type: 'string',
      format: 'date-time',
      description: '세션을 시작한 시각 (ISO 8601)',
    },
  };

  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        format: 'uuid',
        description: 'check_session이 준 UUID. 응답을 받지 못해 다시 보낼 때는 같은 값을 쓴다',
      },
      ...SaveSessionTool.NOTE_PROPERTIES,
    },
    required: ['request_id', 'source_session_id', 'tool', 'title'],
  };

  constructor(private readonly sessions: SessionService) {
    super();
  }

  async handle(actor: Actor, raw: unknown, site: string): Promise<SaveSessionResponse> {
    return SaveSessionResponse.of(
      await this.sessions.save(actor, SaveSessionRequest.from(raw)),
      site,
    );
  }
}
