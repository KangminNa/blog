import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { SearchSessionsInput } from './session.input';
import { SessionQuery } from './session.query';
import type { SessionHitPageView } from './session.view';

// MCP 도구 search_sessions: 저장된 세션 노트를 키워드로 찾는다. 요청자가 볼 수 있는 세션만 나온다.
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 이 도구를 쓰는 스킬도 함께 고친다.
@Injectable()
export class SearchSessionsTool extends BaseTool {
  readonly name = 'search_sessions';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly description = [
    '저장된 세션 노트를 키워드로 찾는다. 제목과 본문에서 찾고, 한국어도 된다.',
    '띄어 쓴 단어가 모두 들어 있는 세션만 찾는다. 대소문자를 구분하니 없으면 표기를 바꿔 다시 찾는다.',
    'project, tool, from, to로 좁힐 수 있다. from과 to는 마지막 저장 시각 기준이다.',
    '결과는 처음 저장한 때가 최근인 세션부터 나온다. next가 있으면 cursor에 그대로 넣어 다음 쪽을 부른다.',
    '이 연결이 볼 수 있는 세션만 나온다. 내용 전체는 session_id로 get_session을 불러 읽는다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      query: {
        type: 'string',
        maxLength: SearchSessionsInput.QUERY_MAX,
        description: '찾을 말. 에러 메시지나 코드 이름처럼 본문에 그대로 있을 말이 잘 찾아진다',
      },
      project: { type: 'string', maxLength: 100, description: '이 프로젝트의 세션만' },
      tool: { type: 'string', maxLength: 40, description: '이 AI 도구의 세션만 (예: claude-code)' },
      from: {
        type: 'string',
        format: 'date-time',
        description: '이 시각부터 저장된 세션만 (ISO 8601)',
      },
      to: {
        type: 'string',
        format: 'date-time',
        description: '이 시각까지 저장된 세션만 (ISO 8601)',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: SearchSessionsInput.LIMIT_MAX,
        default: SearchSessionsInput.LIMIT_DEFAULT,
        description: '한 쪽에 받을 세션 수',
      },
      cursor: { type: 'string', maxLength: 100, description: '앞 응답의 next 값 그대로' },
    },
    required: ['query'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<SessionHitPageView> {
    return this.sessions.search(actor, SearchSessionsInput.from(raw));
  }
}
