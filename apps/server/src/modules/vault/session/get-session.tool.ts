import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { GetSessionInput } from './session.input';
import { SessionQuery } from './session.query';
import type { SessionNoteView } from './session.view';

// MCP 도구 get_session: 세션 하나의 지금 판을 읽는다. 볼 수 없는 세션은 없는 세션과 똑같이 답한다.
@Injectable()
export class GetSessionTool extends BaseTool {
  readonly name = 'get_session';
  readonly scope = Actor.READ_PUBLIC;
  override readonly orScope = Actor.READ_ALL;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly description = [
    '저장된 세션 노트 하나의 지금 판을 읽는다.',
    '제목, 프로젝트, 도구, 시작·마지막 저장 시각, 판 번호, 태그와 내용이 있는 칸을 준다.',
    '칸 이름은 save_session의 입력과 같다 (did, decisions, blocked, quotes, extra).',
    '[지움: 종류]는 저장할 때 지운 비밀값 자리다. session_id는 search_sessions의 결과에서 얻는다.',
    '없거나 이 연결이 볼 수 없는 세션이면 not_found가 온다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      session_id: { type: 'string', format: 'uuid', description: '읽을 세션의 id' },
    },
    required: ['session_id'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<SessionNoteView> {
    return this.sessions.note(actor, GetSessionInput.from(raw));
  }
}
