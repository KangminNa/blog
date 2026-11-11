import { Body, Controller, Get, Put } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { SaveNoticeSettingsInput } from './notice-settings.input';
import { NoticeSettingsQuery } from './notice-settings.query';
import { NoticeSettingsService } from './notice-settings.service';
import type { NoticeSettingsView } from './notice-settings.view';

// 알림 설정 (7단계, 콘솔 자동화 › 알림): 묶음 간격 · 조용한 시간 · 종류별 경로. 주인만.
@Controller('api/notice-settings')
export class NoticeSettingsController {
  constructor(
    private readonly query: NoticeSettingsQuery,
    private readonly service: NoticeSettingsService,
  ) {}

  @Get()
  get(@CurrentActor() actor: Actor): Promise<NoticeSettingsView> {
    return this.query.get(actor);
  }

  @Put()
  save(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<NoticeSettingsView> {
    return this.service.save(actor, SaveNoticeSettingsInput.from(body));
  }
}
