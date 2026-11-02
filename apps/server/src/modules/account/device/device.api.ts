import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, SecretBox } from '../../platform';
import { AddRunnerInput, ConsentInput, UpdateDeviceInput } from './device.input';
import { DeviceQuery } from './device.query';
import { DeviceService } from './device.service';
import type { ConsentResultView, ConsentView, DeviceListView, DeviceView } from './device.view';

// 승인 화면(/connect)과 관리 화면의 기기 화면가 부르는 API. 모두 로그인한 주인만.
@Controller('api')
export class DeviceController {
  constructor(
    private readonly devices: DeviceQuery,
    private readonly service: DeviceService,
    private readonly box: SecretBox,
  ) {}

  /** 승인 화면에 보일 것: 어느 AI 도구가, 어떤 이름·권한으로 연결하려 하는지 */
  @Get('connect')
  consent(@CurrentActor() actor: Actor, @Query() query: unknown): ConsentView {
    return this.devices.consent(actor, ConsentInput.from(query, this.box));
  }

  /** 연결: { request, name } → AI 도구에게 돌려보낼 주소 (코드 포함) */
  @HttpCode(200)
  @Post('connect/approve')
  async approve(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<ConsentResultView> {
    const request = ConsentInput.from(body, this.box);
    return (await this.service.approve(actor, request)).view(request);
  }

  /** 거절: { request } → 오류를 붙여 돌려보낼 주소 */
  @HttpCode(200)
  @Post('connect/deny')
  deny(@CurrentActor() actor: Actor, @Body() body: unknown): ConsentResultView {
    return this.devices.deniedRedirect(actor, ConsentInput.from(body, this.box));
  }

  @Get('devices')
  list(@CurrentActor() actor: Actor): Promise<DeviceListView> {
    return this.devices.list(actor);
  }

  /** 러너 추가: { requestId, name }. run 권한만 가진 기기. 토큰 원문은 이번 응답에만 */
  @Post('devices/runner')
  async addRunner(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<DeviceView> {
    return (await this.service.addRunner(actor, AddRunnerInput.from(body))).view();
  }

  /** 이름·권한 바꾸기: { name?, scopes?, version } */
  @Patch('devices/:id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DeviceView> {
    return (await this.service.update(actor, UpdateDeviceInput.from(id, body))).view();
  }

  @HttpCode(200)
  @Post('devices/:id/revoke')
  async revoke(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<DeviceView> {
    return (await this.service.revoke(actor, id)).view();
  }

  /** 예비 기기 토큰 (OAuth를 못 쓰는 도구용). 원문은 이번 응답에만 */
  @HttpCode(200)
  @Post('devices/:id/token')
  async token(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<DeviceView> {
    return (await this.service.issueDeviceToken(actor, id)).view();
  }
}
