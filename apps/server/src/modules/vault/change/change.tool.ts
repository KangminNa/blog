import { Injectable } from '@nestjs/common';
import { Actor, BaseResponse, BaseTool } from '../../platform';
import { SubmitChangesInput } from './change.input';
import { ChangeService } from './change.service';
import { ChangeOps } from './change-op';
import type { ChangeSet } from './change-set';

/** submit_changes의 답: 변경마다 판정을 바로 알려 준다. 검토나 거부가 있어도 호출은 성공이다 */
export class SubmitChangesResponse extends BaseResponse {
  private constructor(private readonly set: ChangeSet) {
    super();
  }

  static of(set: ChangeSet): SubmitChangesResponse {
    return new SubmitChangesResponse(set);
  }

  toJSON(): object {
    return {
      change_set_id: this.set.id,
      ops: this.set.ops.map((op) => ({
        seq: op.seq,
        verdict: op.verdict,
        status: op.status,
        reason: op.reason,
      })),
    };
  }
}

// MCP 도구 submit_changes: AI의 정리 결과를 변경 묶음 하나로 낸다. 작업을 끝내지는 않는다 (러너의 submit_result).
// 설명과 입력 모양은 AI가 읽고 인자를 만드는 글이다. 칸을 바꾸면 이 도구를 쓰는 스킬도 함께 고친다.
@Injectable()
export class SubmitChangesTool extends BaseTool {
  readonly name = 'submit_changes';
  readonly scope = Actor.TIDY;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly description = [
    '정리 결과(wiki 쓰기·고치기, 세션의 대표 wiki, 연결, 카테고리 제안)를 변경 묶음 하나로 낸다.',
    '서버가 변경마다 규칙을 대 보고 바로 합치기(merge) · 검토(review) · 거부(reject)를 정해 돌려준다.',
    '검토나 거부가 있어도 호출은 성공이고, 변경마다 status와 reason을 본다.',
    'op마다 payload: wiki.create { title, body_md } · wiki.revise { body_md, title? }(target_id = wiki, 본문 전체를 보낸다) ·',
    'session.assign { wiki_id }(target_id = 세션) · edge.add·edge.remove { src, dst, kind }(kind: material · link · similar) ·',
    'category.create { name, description?, color?, sort? } · category.assign { category_id }(target_id = wiki).',
    'payload의 id 자리에 @번호를 쓰면 이 묶음의 그 번호(1부터) 변경이 만든 것을 가리킨다. 예: wiki.create 뒤에 session.assign { wiki_id: "@1" }.',
    '가리킨 변경이 바로 합쳐지지 않았으면 이 변경은 거부된다.',
    'base_version에는 읽을 때 본 version을 적는다. 그사이 바뀌었으면 검토로 간다.',
    '새 내용은 늘 비공개이고 공개 여부는 정할 수 없다. 사람이 고친 칸과 연결은 덮지 못하고 검토로 간다.',
    '작업 토큰이면 작업 하나에 묶음 하나다: 다시 내면 첫 결과를 돌려준다.',
  ].join(' ');
  readonly inputSchema = {
    properties: {
      request_id: {
        type: 'string',
        maxLength: 200,
        description: '이 요청의 id. 응답을 받지 못해 다시 보낼 때는 같은 값을 쓴다',
      },
      message: { type: 'string', maxLength: 2000, description: '왜 바꾸는지' },
      ops: {
        type: 'array',
        minItems: 1,
        maxItems: SubmitChangesInput.OPS_MAX,
        description: '변경들. 앞에서부터 차례로 판정하고 적용한다',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ChangeOps.FOR_AI },
            target_id: { type: 'string', format: 'uuid', description: '대상 id' },
            base_version: {
              type: 'integer',
              minimum: 1,
              description: '읽을 때 본 대상의 version',
            },
            payload: { type: 'object', description: '변경의 내용. 칸은 op마다 다르다' },
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

  async handle(actor: Actor, raw: unknown): Promise<SubmitChangesResponse> {
    return SubmitChangesResponse.of(await this.changes.submit(actor, SubmitChangesInput.from(raw)));
  }
}
