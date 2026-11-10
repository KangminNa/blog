import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest, SecretBox } from '../../platform';
import { AuthorizationPolicy } from './authorization.policy';
import {
  AddRunnerInput,
  ConsentInput,
  PairCodeRunnerInput,
  PairServerRunnerInput,
  UpdateDeviceInput,
} from './device.input';
import { DeviceQuery } from './device.query';
import { DeviceService } from './device.service';
import {
  ConsentResultView,
  type ConsentView,
  type DeviceListView,
  type DeviceSavedView,
} from './device.view';

// 승인 화면(/connect)과 관리 화면의 기기 화면가 부르는 API. 모두 로그인한 주인만 (서버 러너의 연결만 연결 값으로).
// 기기를 바꾼 뒤에는 그 기기를 돌려주고, 화면은 그 version으로 다음 변경을 보낸다.
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

  /** 연결: { request, name } → AI 도구에게 돌려보낼 주소 (코드와 state) */
  @HttpCode(200)
  @Post('connect/approve')
  async approve(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<ConsentResultView> {
    const request = ConsentInput.from(body, this.box);
    const code = await this.service.approve(actor, request);
    return new ConsentResultView(AuthorizationPolicy.approvedRedirect(request, code.code ?? ''));
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
  async addRunner(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<DeviceSavedView> {
    return (await this.service.addRunner(actor, AddRunnerInput.from(body))).view();
  }

  /**
   * 서버 러너의 연결: { secret } → 서버 러너 기기와 새 토큰 (원문은 이번 응답에만).
   * 로그인 없이 부른다. 서버와 러너만 보는 볼륨의 연결 값이 곧 권한이다 (ServerRunnerPolicy)
   */
  @HttpCode(200)
  @Post('devices/server-runner')
  async pairServerRunner(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Body() body: unknown,
  ): Promise<DeviceSavedView> {
    const input = PairServerRunnerInput.from(body);
    return (await this.service.pairServerRunner(actor, input, req.ip ?? '')).view();
  }

  /**
   * 코드 러너 칸이 스스로 연결한다: { secret, slot } → 칸의 기기와 토큰 (docs/코드작업.md).
   * 로그인 없이 부른다. 칸에만 붙는 볼륨의 연결 값이 곧 권한이다 (서버 러너와 값이 다르다)
   */
  @HttpCode(200)
  @Post('devices/code-runner')
  async pairCodeRunner(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Body() body: unknown,
  ): Promise<DeviceSavedView> {
    const input = PairCodeRunnerInput.from(body);
    return (await this.service.pairCodeRunner(actor, input, req.ip ?? '')).view();
  }

  /** 이름·권한 바꾸기: { name?, scopes?, version } */
  @Patch('devices/:id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DeviceSavedView> {
    return (await this.service.update(actor, UpdateDeviceInput.from(id, body))).view();
  }

  @HttpCode(200)
  @Post('devices/:id/revoke')
  async revoke(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<DeviceSavedView> {
    return (await this.service.revoke(actor, id)).view();
  }

  /** 예비 기기 토큰 (OAuth를 못 쓰는 도구용). 원문은 이번 응답에만 */
  @HttpCode(200)
  @Post('devices/:id/token')
  async token(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<DeviceSavedView> {
    return (await this.service.issueDeviceToken(actor, id)).view();
  }
}
