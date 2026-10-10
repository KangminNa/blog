import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, SecretBox } from '../../platform';
import { DeviceQuery } from './device.query';
import { ConsentRequest, UpdateDeviceRequest } from './device.request';
import {
  ConsentResponse,
  ConsentResultResponse,
  DeviceListResponse,
  DeviceResponse,
} from './device.response';
import { DeviceService } from './device.service';

// 승인 화면(/connect)과 관리 화면의 기기 시트가 부르는 API. 모두 로그인한 주인만.
@Controller('api')
export class DeviceController {
  constructor(
    private readonly devices: DeviceQuery,
    private readonly service: DeviceService,
    private readonly box: SecretBox,
  ) {}

  /** 승인 화면에 보일 것: 어느 AI 도구가, 어떤 이름·권한으로 연결하려 하는지 */
  @Get('connect')
  consent(@CurrentActor() actor: Actor, @Query() query: unknown): ConsentResponse {
    return ConsentResponse.of(this.devices.consent(actor, ConsentRequest.from(query, this.box)));
  }

  /** 연결: { request, name } → AI 도구에게 돌려보낼 주소 (코드 포함) */
  @HttpCode(200)
  @Post('connect/approve')
  async approve(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
  ): Promise<ConsentResultResponse> {
    const request = ConsentRequest.from(body, this.box);
    return ConsentResultResponse.approved(request, await this.service.approve(actor, request));
  }

  /** 거절: { request } → 오류를 붙여 돌려보낼 주소 */
  @HttpCode(200)
  @Post('connect/deny')
  deny(@CurrentActor() actor: Actor, @Body() body: unknown): ConsentResultResponse {
    return ConsentResultResponse.of(
      this.devices.deniedRedirect(actor, ConsentRequest.from(body, this.box)),
    );
  }

  @Get('devices')
  async list(@CurrentActor() actor: Actor): Promise<DeviceListResponse> {
    return DeviceListResponse.of(await this.devices.list(actor));
  }

  /** 이름·권한 바꾸기: { name?, scopes?, version } */
  @Patch('devices/:id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DeviceResponse> {
    return DeviceResponse.of(await this.service.update(actor, id, UpdateDeviceRequest.from(body)));
  }

  @HttpCode(200)
  @Post('devices/:id/revoke')
  async revoke(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<DeviceResponse> {
    return DeviceResponse.of(await this.service.revoke(actor, id));
  }

  /** 예비 기기 토큰 (OAuth를 못 쓰는 도구용). 원문은 이번 응답에만 */
  @HttpCode(200)
  @Post('devices/:id/token')
  async token(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<DeviceResponse> {
    return DeviceResponse.of(await this.service.issueDeviceToken(actor, id));
  }
}
