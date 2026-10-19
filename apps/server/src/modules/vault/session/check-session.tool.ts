import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { CheckSessionRequest } from './save-session.request';
import { SaveSessionTool } from './save-session.tool';
import { SessionQuery } from './session.query';
import { SessionCheckResponse } from './session.response';

// MCP 도구 check_session: 저장하기 전에 세션 노트를 검사한다 (아무것도 쓰지 않는다).
// 대화 원문이나 스크립트를 쓸 수 없는 도구(ChatGPT·Claude 앱)도 이것으로 기계 검사를 하고, 저장에 쓸 id를 받는다.
@Injectable()
export class CheckSessionTool extends BaseTool {
  readonly name = 'check_session';
  readonly scope = Actor.UPLOAD;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly description = [
    '세션 노트를 저장하기 전에 검사한다. 저장하지 않는다.',
    '노트 모양이 틀리면 고칠 칸을 알려 주고, 저장하면 서버가 지울 비밀값을 warnings로 알려 준다.',
    '이번 저장에 쓸 request_id와 대화 id(source_session_id)를 준다. 대화 id를 모르면 비워 두고, 받은 값을 이 대화의 다음 저장에도 쓴다.',
    'site는 노트가 올라갈 블로그 주소다. 사용자에게 보여 주고 확인받은 뒤 save_session으로 저장한다.',
  ].join(' ');
  readonly inputSchema = {
    properties: SaveSessionTool.NOTE_PROPERTIES,
    required: ['title'],
  };

  constructor(private readonly sessions: SessionQuery) {
    super();
  }

  async handle(actor: Actor, raw: unknown, site: string): Promise<SessionCheckResponse> {
    return SessionCheckResponse.of(
      await this.sessions.check(actor, CheckSessionRequest.from(raw)),
      site,
    );
  }
}
