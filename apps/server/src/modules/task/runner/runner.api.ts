import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Runner } from './runner';
import { RunnerAcceptingInput } from './runner.input';
import { RunnerQuery } from './runner.query';
import { RunnerService } from './runner.service';
import { type RunnerListView, RunnerView } from './runner.view';

/** 러너 목록 */
export class RunnerListResponse extends BaseResponse {
  private constructor(private readonly view: RunnerListView) {
    super();
  }

  static of(view: RunnerListView): RunnerListResponse {
    return new RunnerListResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 바꾼 러너 하나. 지금 하는 일은 목록에서만 (null). 화면은 이 version으로 다음 변경을 보낸다 */
export class RunnerResponse extends BaseResponse {
  private constructor(private readonly runner: Runner) {
    super();
  }

  static of(runner: Runner): RunnerResponse {
    return new RunnerResponse(runner);
  }

  toJSON(): object {
    const r = this.runner;
    const now = new Date();
    return new RunnerView(
      r.id,
      r.deviceId,
      r.accepting,
      r.online(now),
      r.lastSeenAt,
      null,
      r.version,
    ).toJSON();
  }
}

// 러너 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/runners')
export class RunnerController {
  constructor(
    private readonly query: RunnerQuery,
    private readonly service: RunnerService,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<RunnerListResponse> {
    return RunnerListResponse.of(await this.query.list(actor));
  }

  /** 일 받기 켜기·끄기: { accepting, version } */
  @HttpCode(200)
  @Post(':id/accepting')
  async accepting(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<RunnerResponse> {
    return RunnerResponse.of(
      await this.service.setAccepting(actor, RunnerAcceptingInput.from(id, body)),
    );
  }
}
