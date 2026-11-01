import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Approval } from './approval';
import { ApprovalIdInput, DecideApprovalInput, ListApprovalsInput } from './approval.input';
import { ApprovalQuery } from './approval.query';
import { ApprovalService } from './approval.service';
import { type ApprovalPageView, ApprovalView } from './approval.view';

/** 결재 목록 한 쪽 */
export class ApprovalPageResponse extends BaseResponse {
  private constructor(private readonly page: ApprovalPageView) {
    super();
  }

  static of(page: ApprovalPageView): ApprovalPageResponse {
    return new ApprovalPageResponse(page);
  }

  toJSON(): object {
    return this.page.toJSON();
  }
}

/** 결재 하나. 읽기와 쓰기가 같은 모양이다 */
export class ApprovalResponse extends BaseResponse {
  private constructor(private readonly view: ApprovalView) {
    super();
  }

  static of(view: ApprovalView): ApprovalResponse {
    return new ApprovalResponse(view);
  }

  static saved(a: Approval): ApprovalResponse {
    return new ApprovalResponse(
      new ApprovalView(
        a.id,
        a.taskId,
        a.agentId,
        a.action,
        a.targetKind,
        a.targetId,
        a.targetVersion,
        a.status,
        a.decidedBy,
        a.decidedAt,
        a.note,
        a.version,
        a.createdAt,
      ),
    );
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

// 결재 메뉴. 주인만 (Service·Query 첫 줄에서 확인). 작업에 묶이지 않는 결재가 있어 작업 아래에 두지 않는다.
@Controller('api/approvals')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalQuery,
    private readonly service: ApprovalService,
  ) {}

  /** ?status=pending · ?cursor=<앞 응답의 next> */
  @Get()
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<ApprovalPageResponse> {
    return ApprovalPageResponse.of(
      await this.approvals.list(actor, ListApprovalsInput.from(query)),
    );
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<ApprovalResponse> {
    return ApprovalResponse.of(await this.approvals.get(actor, ApprovalIdInput.from(id)));
  }

  /** { version, decision: approve · revise · reject, note? } */
  @HttpCode(200)
  @Post(':id/decide')
  async decide(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApprovalResponse> {
    return ApprovalResponse.saved(
      await this.service.decide(actor, DecideApprovalInput.from(id, body)),
    );
  }
}
