import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { AgentUpdatesInput, PostUpdateInput } from './chat-update.input';
import { ChatUpdates } from './chat-update.policy';
import { ChatUpdateQuery } from './chat-update.query';
import { ChatUpdateService } from './chat-update.service';
import { type AgentUpdatesView, PostedUpdateView } from './chat-update.view';

// 대화의 소식 MCP 도구 (2차 1-1, docs/API설계.md 4장). 글은 task.tools.ko.json에.

/** agent_updates: 새 소식과 대화마다의 상태판. delegate 기기는 자기 대화, news 기기(훅 · 상태 줄)는 모든 대화 */
@Injectable()
export class AgentUpdatesTool extends BaseTool {
  readonly name = 'agent_updates';
  readonly scope = Actor.DELEGATE;
  override readonly orScope = Actor.NEWS;
  readonly readOnly = true;
  readonly inputSchema = {
    properties: {
      chat_id: { type: 'string', format: 'uuid' },
      project: { type: 'string', maxLength: 400 },
      after: { type: 'integer', minimum: 0 },
      wait_seconds: { type: 'integer', minimum: 0, maximum: AgentUpdatesInput.WAIT_MAX },
    },
  };

  constructor(private readonly updates: ChatUpdateQuery) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<AgentUpdatesView> {
    return this.updates.updates(actor, AgentUpdatesInput.from(raw));
  }
}

/** post_update: 대화에서 맡은 일을 하는 에이전트가 중간 보고 · 정한 것 · 가정을 남긴다 (작업 토큰) */
@Injectable()
export class PostUpdateTool extends BaseTool {
  readonly name = 'post_update';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  readonly inputSchema = {
    properties: {
      kind: { type: 'string', enum: [...ChatUpdates.POSTED] },
      text: { type: 'string', maxLength: ChatUpdates.TEXT_MAX },
    },
    required: ['kind', 'text'],
  };

  constructor(private readonly updates: ChatUpdateService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<PostedUpdateView> {
    return new PostedUpdateView(await this.updates.post(actor, PostUpdateInput.from(raw)));
  }
}
