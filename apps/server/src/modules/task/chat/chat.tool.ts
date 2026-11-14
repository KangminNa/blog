import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { Chat } from './chat';
import { AgentReplyInput, AskAgentInput } from './chat.input';
import { ChatQuery } from './chat.query';
import { ChatService } from './chat.service';
import type { ChatReplyView, ChatView } from './chat.view';

// 내 컴퓨터의 AI 도구가 서버 팀에 일을 맡기는 MCP 도구 (기기 권한 delegate, 관리자가 기기 메뉴에서 켠다, 2026-11-14).
// 메시지 하나 = 콘솔의 대화와 같은 회차 작업 하나. 답은 agent_reply로 기다린다. 결재(승인 · 반려)는 콘솔에서만 한다.

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

/** agent_reply: ask_agent로 보낸 메시지의 답을 기다려 받는다 */
@Injectable()
export class AgentReplyTool extends BaseTool {
  readonly name = 'agent_reply';
  readonly scope = Actor.DELEGATE;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      chat_id: { type: 'string', format: 'uuid' },
      wait_seconds: {
        type: 'integer',
        minimum: 0,
        maximum: AgentReplyInput.WAIT_MAX,
      },
    },
    required: ['chat_id'],
  };

  constructor(private readonly chats: ChatQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<ChatReplyView> {
    return this.chats.reply(actor, AgentReplyInput.from(raw));
  }
}
