import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { DecideChangeInput, ListChangesInput, RevertChangeInput } from './change.input';
import { ChangeQuery } from './change.query';
import { ChangeService } from './change.service';
import type { ChangeSetView, WaitingChangePageView } from './change.view';

// 승인함과 되돌리기. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/changes')
export class ChangeController {
  constructor(
    private readonly changes: ChangeQuery,
    private readonly service: ChangeService,
  ) {}

  /** ?status=waiting · ?cursor=<앞 응답의 next> */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<WaitingChangePageView> {
    return this.changes.waiting(actor, ListChangesInput.from(query));
  }

  @HttpCode(200)
  @Post(':id/ops/:seq/decide')
  async decide(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('seq') seq: string,
    @Body() body: unknown,
  ): Promise<ChangeSetView> {
    return (await this.service.decide(actor, DecideChangeInput.from(id, seq, body))).view();
  }

  @HttpCode(200)
  @Post(':id/revert')
  async revert(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ChangeSetView> {
    return (await this.service.revert(actor, RevertChangeInput.from(id, body))).view();
  }
}
