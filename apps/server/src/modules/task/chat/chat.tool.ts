import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { Chat } from './chat';
import { AskAgentInput } from './chat.input';
import { ChatService } from './chat.service';
import type { ChatView } from './chat.view';

// 내 컴퓨터의 AI 도구가 서버 팀에 일을 맡기는 MCP 도구 (기기 권한 delegate, 관리자가 기기 메뉴에서 켠다, 2026-11-14).
// 메시지 하나 = 콘솔의 대화와 같은 회차 작업 하나 (일하는 중이면 덧붙인 말). 상대를 비우면 배정하고, 애매하면 질문이 소식으로 온다.
// 기다리지 않는다: 답 · 소식 · 질문은 agent_updates로.
// 결재(승인 · 반려)는 콘솔에서만 한다.

/** ask_agent: 서버 팀(관리자 바로 아래 에이전트)에게 메시지를 보낸다 */
@Injectable()
export class AskAgentTool extends BaseTool {
  readonly name = 'ask_agent';
  readonly scope = Actor.DELEGATE;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        maxLength: 200,
      },
      message: { type: 'string', maxLength: Chat.MESSAGE_MAX },
      agent: { type: 'string', maxLength: 100 },
      chat_id: {
        type: 'string',
        format: 'uuid',
      },
      goal: { type: 'string', maxLength: Chat.GOAL_MAX },
      project: { type: 'string', maxLength: 400 },
      deliver: { type: 'string', enum: ['html', 'blog', 'browser', 'code'] },
      choice: { type: 'string', format: 'uuid' },
    },
    required: ['request_id', 'message'],
  };

  constructor(private readonly chats: ChatService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<ChatView> {
    return (await this.chats.ask(actor, AskAgentInput.from(raw))).view();
  }
}
