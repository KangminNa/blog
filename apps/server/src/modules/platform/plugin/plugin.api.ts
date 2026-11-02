import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '../base/actor';
import type { ActionResult } from '../base/base-action';
import { CurrentActor } from '../http/current-actor';
import { PluginSettingsInput } from './plugin.input';
import { PluginQuery } from './plugin.query';
import { PluginService } from './plugin.service';
import type { PluginListView, PluginSettingsView, PluginStateView } from './plugin.view';

// 읽기는 누구나(보는 사람마다 다르게), 쓰기는 주인만. 설치 마법사의 플러그인 단계와 관리 화면이 함께 쓴다.
@Controller('api/plugins')
export class PluginController {
  constructor(
    private readonly plugins: PluginQuery,
    private readonly service: PluginService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<PluginListView> {
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

  /** 관리 동작의 결과 (예: 연결 확인) */
  @HttpCode(200)
  @Post(':name/actions/:action')
  run(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Param('action') action: string,
  ): Promise<ActionResult> {
    return this.service.runAction(actor, name, action);
  }
}
