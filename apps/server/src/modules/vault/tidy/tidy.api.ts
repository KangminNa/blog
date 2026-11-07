import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { SaveTidySettingsInput } from './tidy.input';
import { TidyQuery } from './tidy.query';
import { TidyService } from './tidy.service';
import type { TidyBacklogView, TidySettingsView } from './tidy.view';

// 세션 정리 설정과 기존 세션 재처리. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/tidy')
export class TidyController {
  constructor(
    private readonly query: TidyQuery,
    private readonly service: TidyService,
  ) {}

  /** 자동 정리 설정 */
  @Get('settings')
  settings(@CurrentActor() actor: Actor): Promise<TidySettingsView> {
    return this.query.settings(actor);
  }

  @Put('settings')
  save(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<TidySettingsView> {
    return this.service.save(actor, SaveTidySettingsInput.from(body));
  }

  /** 쌓인 세션 정리를 요청한 결과 */
  @HttpCode(200)
  @Post('backlog')
  backlog(@CurrentActor() actor: Actor): Promise<TidyBacklogView> {
    return this.service.backlog(actor);
  }
}
