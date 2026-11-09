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
  readonly description = [
    '위험한 동작(공개, 전송, 삭제)을 직접 하지 않고 주인에게 결재를 올린다.',
    '대상과 판 번호를 함께 적는다. 승인 뒤 내용이 바뀌면 실행되지 않는다.',
    '작업은 결재를 기다리는 상태가 되고, 이 실행은 여기서 끝낸다. 주인이 고쳐 달라고 하면 그 말과 함께 일이 다시 온다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        maxLength: 200,
        description: '이 요청의 id. 응답을 받지 못해 다시 보낼 때는 같은 값을 쓴다',
      },
      action: {
        type: 'string',
        maxLength: 100,
        description: '결재할 동작 (예: blog.post.publish). 이 에이전트에게 맡긴 동작만',
      },
      target_kind: { type: 'string', maxLength: 40, description: '대상의 종류 (예: post)' },
      target_id: { type: 'string', format: 'uuid', description: '대상 id' },
      target_version: { type: 'integer', minimum: 0, description: '결재받을 대상의 판 번호' },
      note: { type: 'string', maxLength: 8000, description: '주인에게 남길 말' },
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
