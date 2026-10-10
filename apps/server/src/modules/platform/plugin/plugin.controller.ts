import { Controller, Get, Param } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { PluginQuery } from './plugin.query';
import { PluginListResponse, PluginSettingsResponse } from './plugin.response';

@Controller('plugins')
export class PluginController {
  constructor(private readonly plugins: PluginQuery) {}

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
}
