import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { RequestApprovalInput } from './approval.input';
import { ApprovalService } from './approval.service';
import type { ApprovalRequestedView } from './approval.view';

// MCP 도구 request_approval: 발행·전송·삭제처럼 위험한 동작을 주인에게 올린다.
// 작업 토큰으로만 부른다. 어느 작업·어느 에이전트인지는 입력이 아니라 토큰에서 나온다.
@Injectable()
export class RequestApprovalTool extends BaseTool {
  readonly name = 'request_approval';
  readonly scope = Actor.AGENT;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        maxLength: 200,
      },
      action: {
        type: 'string',
        maxLength: 100,
      },
      target_kind: { type: 'string', maxLength: 40 },
      target_id: { type: 'string', format: 'uuid' },
      target_version: { type: 'integer', minimum: 0 },
      note: { type: 'string', maxLength: 8000 },
    },
    required: ['request_id', 'action', 'target_kind', 'target_id', 'target_version'],
  };

  constructor(private readonly approvals: ApprovalService) {
    super();
  }

  /** 작업은 결재를 기다리므로 에이전트는 여기서 멈춘다 */
  async handle(actor: Actor, raw: unknown): Promise<ApprovalRequestedView> {
    return (await this.approvals.request(actor, RequestApprovalInput.from(raw))).requestedView();
  }
}
