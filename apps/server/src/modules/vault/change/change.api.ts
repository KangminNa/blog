import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { DecideChangeInput, ListChangesInput, RevertChangeInput } from './change.input';
import { ChangeQuery } from './change.query';
import { ChangeService } from './change.service';
import { ChangeOpView, ChangeSetView, type WaitingChangePageView } from './change.view';
import type { ChangeSet } from './change-set';

/** 승인함 한 쪽 */
export class WaitingChangePageResponse extends BaseResponse {
  private constructor(private readonly page: WaitingChangePageView) {
    super();
  }

  static of(page: WaitingChangePageView): WaitingChangePageResponse {
    return new WaitingChangePageResponse(page);
  }

  toJSON(): object {
    return this.page.toJSON();
  }
}

/** 변경 묶음 하나의 결과. 화면은 이 version으로 다음 결정을 보낸다 */
export class ChangeSetResponse extends BaseResponse {
  private constructor(private readonly set: ChangeSet) {
    super();
  }

  static of(set: ChangeSet): ChangeSetResponse {
    return new ChangeSetResponse(set);
  }

  toJSON(): object {
    const s = this.set;
    return new ChangeSetView(
      s.id,
      s.version,
      s.kind,
      s.status,
      s.message,
      s.revertedBy,
      s.ops.map(
        (op) =>
          new ChangeOpView(
            op.seq,
            op.name,
            op.targetKind,
            op.targetId,
            op.verdict,
            op.rule,
            op.status,
            op.reason,
          ),
      ),
    ).toJSON();
  }
}

// 승인함과 되돌리기. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/changes')
export class ChangeController {
  constructor(
    private readonly changes: ChangeQuery,
    private readonly service: ChangeService,
  ) {}

  /** ?status=waiting · ?cursor=<앞 응답의 next> */
  @Get()
  async list(
    @CurrentActor() actor: Actor,
    @Query() query: unknown,
  ): Promise<WaitingChangePageResponse> {
    return WaitingChangePageResponse.of(
      await this.changes.waiting(actor, ListChangesInput.from(query)),
    );
  }

  @HttpCode(200)
  @Post(':id/ops/:seq/decide')
  async decide(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('seq') seq: string,
    @Body() body: unknown,
  ): Promise<ChangeSetResponse> {
    const decision = DecideChangeInput.from(id, seq, body);
    return ChangeSetResponse.of(
      await this.service.decide(actor, decision.setId, decision.seq, decision),
    );
  }

  @HttpCode(200)
  @Post(':id/revert')
  async revert(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ChangeSetResponse> {
    const req = RevertChangeInput.from(id, body);
    return ChangeSetResponse.of(await this.service.revert(actor, req.setId, req.version));
  }
}
