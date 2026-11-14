import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { InboxQuery } from './inbox.query';
import type { InboxView } from './inbox.view';

// MCP 도구 inbox: 기다리는 결재 · 질문의 수와 최근 것 (브라우저 확장의 배지). 권한 inbox. 결재는 콘솔에서만
@Injectable()
export class InboxTool extends BaseTool {
  readonly name = 'inbox';
  readonly scope = Actor.INBOX;
  readonly readOnly = true;
  override readonly idempotent = true;
  readonly inputSchema = { properties: {} };

  constructor(private readonly inbox: InboxQuery) {
    super();
  }

  handle(actor: Actor): Promise<InboxView> {
    return this.inbox.inbox(actor);
  }
}
