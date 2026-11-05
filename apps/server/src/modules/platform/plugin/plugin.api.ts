import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type { Actor } from '../base/actor';
import type { ActionResult } from '../base/base-action';
import { BaseResponse } from '../base/base-response';
import { CurrentActor } from '../http/current-actor';
import { PluginSettingsInput } from './plugin.input';
import { PluginQuery } from './plugin.query';
import { PluginService } from './plugin.service';
import {
  PluginActionResultView,
  type PluginListView,
  type PluginSettingsView,
} from './plugin.view';
import type { PluginState } from './plugin-state';

/** 플러그인 목록. 관리 정보(설정 칸·권한·관리 동작)는 주인과 서버 자신만 */
export class PluginListResponse extends BaseResponse {
  private constructor(
    private readonly view: PluginListView,
    private readonly full: boolean,
  ) {
    super();
  }

  static of(view: PluginListView, actor: Actor): PluginListResponse {
    return new PluginListResponse(view, actor.canManage());
  }

  toJSON(): object {
    return this.full ? this.view.toJSON() : this.view.toPublicJSON();
  }
}

export class PluginSettingsResponse extends BaseResponse {
  private constructor(private readonly view: PluginSettingsView) {
    super();
  }

  static of(view: PluginSettingsView): PluginSettingsResponse {
    return new PluginSettingsResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 켜기·끄기·설정 저장의 결과. 화면은 이 뒤에 목록을 다시 불러온다 */
export class PluginStateResponse extends BaseResponse {
  private constructor(private readonly state: PluginState) {
    super();
  }

  static of(state: PluginState): PluginStateResponse {
    return new PluginStateResponse(state);
  }

  toJSON(): object {
    return { name: this.state.name, enabled: this.state.enabled };
  }
}

/** 관리 동작의 결과 (예: 연결 확인) */
export class PluginActionResponse extends BaseResponse {
  private constructor(private readonly view: PluginActionResultView) {
    super();
  }

  static of(result: ActionResult): PluginActionResponse {
    return new PluginActionResponse(
      new PluginActionResultView(result.ok, result.message, result.details),
    );
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

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
    const request = PluginSettingsInput.from(body);
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
