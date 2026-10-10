import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { PluginQuery } from './plugin.query';
import {
  PluginActionResponse,
  PluginListResponse,
  PluginSettingsResponse,
  PluginStateResponse,
} from './plugin.response';
import { PluginService } from './plugin.service';
import { PluginSettingsRequest } from './plugin-settings.request';

// 읽기는 누구나(보는 사람마다 다르게), 쓰기는 주인만. 설치 마법사의 플러그인 단계와 관리 화면이 함께 쓴다.
@Controller('api/plugins')
export class PluginController {
  constructor(
    private readonly plugins: PluginQuery,
    private readonly service: PluginService,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<PluginListResponse> {
    return PluginListResponse.of(await this.plugins.list(actor), actor);
  }

  @Get(':name/settings')
  async settings(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
  ): Promise<PluginSettingsResponse> {
    return PluginSettingsResponse.of(await this.plugins.publicSettings(actor, name));
  }

  @HttpCode(200)
  @Post(':name/enable')
  async enable(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
  ): Promise<PluginStateResponse> {
    return PluginStateResponse.of(await this.service.enable(actor, name));
  }

  @HttpCode(200)
  @Post(':name/disable')
  async disable(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
  ): Promise<PluginStateResponse> {
    return PluginStateResponse.of(await this.service.disable(actor, name));
  }

  @Put(':name/settings')
  async configure(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Body() body: unknown,
  ): Promise<PluginStateResponse> {
    const request = PluginSettingsRequest.from(body);
    return PluginStateResponse.of(await this.service.configure(actor, name, request.values));
  }

  @HttpCode(200)
  @Post(':name/actions/:action')
  async run(
    @CurrentActor() actor: Actor,
    @Param('name') name: string,
    @Param('action') action: string,
  ): Promise<PluginActionResponse> {
    return PluginActionResponse.of(await this.service.runAction(actor, name, action));
  }
}
