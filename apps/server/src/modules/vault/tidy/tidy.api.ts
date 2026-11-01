import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { SaveTidySettingsInput } from './tidy.input';
import { TidyQuery } from './tidy.query';
import { TidyService } from './tidy.service';
import type { TidyBacklogView, TidySettingsView } from './tidy.view';

/** 자동 정리 설정 */
export class TidySettingsResponse extends BaseResponse {
  private constructor(private readonly settings: TidySettingsView) {
    super();
  }

  static of(settings: TidySettingsView): TidySettingsResponse {
    return new TidySettingsResponse(settings);
  }

  toJSON(): object {
    return this.settings.toJSON();
  }
}

/** 쌓인 세션 정리를 요청한 결과 */
export class TidyBacklogResponse extends BaseResponse {
  private constructor(private readonly backlog: TidyBacklogView) {
    super();
  }

  static of(backlog: TidyBacklogView): TidyBacklogResponse {
    return new TidyBacklogResponse(backlog);
  }

  toJSON(): object {
    return this.backlog.toJSON();
  }
}

// 세션 정리 설정과 기존 세션 재처리. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/tidy')
export class TidyController {
  constructor(
    private readonly query: TidyQuery,
    private readonly service: TidyService,
  ) {}

  @Get('settings')
  async settings(@CurrentActor() actor: Actor): Promise<TidySettingsResponse> {
    return TidySettingsResponse.of(await this.query.settings(actor));
  }

  @Put('settings')
  async save(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<TidySettingsResponse> {
    return TidySettingsResponse.of(
      await this.service.save(actor, SaveTidySettingsInput.from(body)),
    );
  }

  @HttpCode(200)
  @Post('backlog')
  async backlog(@CurrentActor() actor: Actor): Promise<TidyBacklogResponse> {
    return TidyBacklogResponse.of(await this.service.backlog(actor));
  }
}
