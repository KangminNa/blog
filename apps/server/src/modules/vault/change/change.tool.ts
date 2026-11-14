import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { SubmitChangesInput } from './change.input';
import { ChangeService } from './change.service';
import type { SubmittedChangesView } from './change.view';
import { ChangeOps } from './change-op';

// MCP 도구 submit_changes: AI의 정리 결과를 변경 묶음 하나로 낸다. 작업을 끝내지는 않는다 (러너의 submit_result).
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 이 도구를 쓰는 스킬도 함께 고친다.
@Injectable()
export class SubmitChangesTool extends BaseTool {
  readonly name = 'submit_changes';
  readonly scope = Actor.TIDY;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        maxLength: 200,
      },
      message: { type: 'string', maxLength: 2000 },
      ops: {
        type: 'array',
        minItems: 1,
        maxItems: SubmitChangesInput.OPS_MAX,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ChangeOps.FOR_AI },
            target_id: { type: 'string', format: 'uuid' },
            base_version: {
              type: 'integer',
              minimum: 1,
            },
            payload: { type: 'object' },
          },
          required: ['op', 'payload'],
        },
      },
    },
    required: ['request_id', 'message', 'ops'],
  };

  constructor(private readonly changes: ChangeService) {
    super();
  }

  async handle(actor: Actor, raw: unknown): Promise<SubmittedChangesView> {
    return (await this.changes.submit(actor, SubmitChangesInput.from(raw))).submittedView();
  }
}
