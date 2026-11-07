import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { RunnerAcceptingInput } from './runner.input';
import { RunnerQuery } from './runner.query';
import { RunnerService } from './runner.service';
import type { RunnerListView, RunnerView } from './runner.view';

// 러너 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
// 바꾼 러너는 지금 하는 일 없이(null) 돌려주고, 화면은 그 version으로 다음 변경을 보낸다.
@Controller('api/runners')
export class RunnerController {
  constructor(
    private readonly query: RunnerQuery,
    private readonly service: RunnerService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<RunnerListView> {
    return this.query.list(actor);
  }

  /** 일 받기 켜기·끄기: { accepting, version } */
  @HttpCode(200)
  @Post(':id/accepting')
  async accepting(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RunnerView> {
    const runner = await this.service.setAccepting(actor, RunnerAcceptingInput.from(id, body));
    return runner.view(new Date());
  }
}
