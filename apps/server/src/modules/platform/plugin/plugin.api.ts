import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { PluginSettingsInput } from './plugin.input';
import { PluginQuery } from './plugin.query';
import { PluginService } from './plugin.service';
import {
  PluginActionResultView,
  type PluginListView,
  type PluginSettingsView,
  type PluginStateView,
  type PluginSummaryListView,
} from './plugin.view';

// 읽기는 누구나(보는 사람마다 다르게), 쓰기는 주인만. 설치 마법사의 플러그인 단계와 관리 화면이 함께 쓴다.
// 켜기·끄기·설정 저장은 그 플러그인의 켜짐을 돌려주고, 화면은 그 뒤에 목록을 다시 불러온다.
@Controller('api/plugins')
export class PluginController {
  constructor(
    private readonly plugins: PluginQuery,
    private readonly service: PluginService,
  ) {}

  /** 관리 정보(설정 칸·권한·관리 동작)는 주인과 서버 자신만 */
  @Get()
  list(@CurrentActor() actor: Actor): Promise<PluginListView | PluginSummaryListView> {
    return this.plugins.list(actor);
  }

  @Get(':name/settings')
  settings(@CurrentActor() actor: Actor, @Param('name') name: string): Promise<PluginSettingsView> {
    return this.plugins.publicSettings(actor, name);
  }

  @HttpCode(200)
  @Post(':name/enable')
  async enable(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
  ): Promise<PluginStateView> {
    return (await this.service.enable(actor, name)).view();
  }

  @HttpCode(200)
  @Post(':name/disable')
  async disable(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
  ): Promise<PluginStateView> {
    return (await this.service.disable(actor, name)).view();
  }

  @Put(':name/settings')
  async configure(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Body() body: unknown,
  ): Promise<PluginStateView> {
    const input = PluginSettingsInput.from(body);
    return (await this.service.configure(actor, name, input.values)).view();
  }

  /** 관리 동작 (예: 연결 확인) */
  @HttpCode(200)
  @Post(':name/actions/:action')
  async run(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Param('action') action: string,
  ): Promise<PluginActionResultView> {
    const result = await this.service.runAction(actor, name, action);
    return new PluginActionResultView(result.ok, result.message, result.details);
  }
}
