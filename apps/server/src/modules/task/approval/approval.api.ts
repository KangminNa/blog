import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { IdInput, ListInput } from '../task/task.input';
import { DecideApprovalInput } from './approval.input';
import { ApprovalQuery } from './approval.query';
import { ApprovalService } from './approval.service';
import type { ApprovalPageView, ApprovalView } from './approval.view';

// 결재 메뉴. 주인만 (Service·Query 첫 줄에서 확인). 작업에 묶이지 않는 결재가 있어 작업 아래에 두지 않는다.
@Controller('api/approvals')
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalQuery,
    private readonly service: ApprovalService,
  ) {}

  /** ?status=pending · ?cursor=<앞 응답의 next> */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<ApprovalPageView> {
    return this.approvals.list(actor, ListInput.from(query));
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<ApprovalView> {
    return this.approvals.get(actor, IdInput.from(id));
  }

  /** { version, decision: approve · revise · reject, note? } */
  @HttpCode(200)
  @Post(':id/decide')
  async decide(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ApprovalView> {
    return (await this.service.decide(actor, DecideApprovalInput.from(id, body))).view();
  }
}
