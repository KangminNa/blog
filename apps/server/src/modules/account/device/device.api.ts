import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  type Actor,
  BaseResponse,
  CurrentActor,
  type HttpRequest,
  SecretBox,
} from '../../platform';
import { AuthorizationPolicy } from './authorization.policy';
import type { AuthorizationCode } from './authorization-code';
import { type Device, DeviceCredential } from './device';
import {
  AddRunnerInput,
  ConsentInput,
  PairServerRunnerInput,
  UpdateDeviceInput,
} from './device.input';
import { DeviceQuery } from './device.query';
import { DeviceService } from './device.service';
import type { ConsentView, DeviceView } from './device.view';

/** 승인 화면 */
export class ConsentResponse extends BaseResponse {
  private constructor(private readonly view: ConsentView) {
    super();
  }

  static of(view: ConsentView): ConsentResponse {
    return new ConsentResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 승인·거절 뒤 브라우저가 갈 곳 (AI 도구가 기다리는 주소) */
export class ConsentResultResponse extends BaseResponse {
  private constructor(private readonly redirect: string) {
    super();
  }

  static of(redirect: string): ConsentResultResponse {
    return new ConsentResultResponse(redirect);
  }

  /** 승인: 코드와 state를 붙인 AI 도구의 주소 */
  static approved(request: ConsentInput, code: AuthorizationCode): ConsentResultResponse {
    return new ConsentResultResponse(
      AuthorizationPolicy.approvedRedirect(request, code.code ?? ''),
    );
  }

  toJSON(): object {
    return { redirect: this.redirect };
  }
}

/** 관리 화면의 기기 목록 */
export class DeviceListResponse extends BaseResponse {
  private constructor(private readonly devices: readonly DeviceView[]) {
    super();
  }

  static of(devices: readonly DeviceView[]): DeviceListResponse {
    return new DeviceListResponse(devices);
  }

  toJSON(): object {
    return { devices: this.devices.map((d) => d.toJSON()) };
  }
}

/** 기기 하나를 바꾼 결과. 예비 기기 토큰을 만들었으면 원문을 이번 한 번만 */
export class DeviceResponse extends BaseResponse {
  private constructor(private readonly device: Device) {
    super();
  }

  static of(device: Device): DeviceResponse {
    return new DeviceResponse(device);
  }

  toJSON(): object {
    const issued = this.device.issuedToken(DeviceCredential.DEVICE);
    return {
      id: this.device.id,
      name: this.device.name,
      scopes: this.device.scopes,
      revokedAt: this.device.revokedAt?.toISOString() ?? null,
      version: this.device.version,
      ...(issued ? { token: issued.token } : {}),
    };
  }
}

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
  consent(@CurrentActor() actor: Actor, @Query() query: unknown): ConsentResponse {
    return ConsentResponse.of(this.devices.consent(actor, ConsentInput.from(query, this.box)));
  }

  /** 연결: { request, name } → AI 도구에게 돌려보낼 주소 (코드 포함) */
  @HttpCode(200)
  @Post('connect/approve')
  async approve(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
  ): Promise<ConsentResultResponse> {
    const request = ConsentInput.from(body, this.box);
    return ConsentResultResponse.approved(request, await this.service.approve(actor, request));
  }

  /** 거절: { request } → 오류를 붙여 돌려보낼 주소 */
  @HttpCode(200)
  @Post('connect/deny')
  deny(@CurrentActor() actor: Actor, @Body() body: unknown): ConsentResultResponse {
    return ConsentResultResponse.of(
      this.devices.deniedRedirect(actor, ConsentInput.from(body, this.box)),
    );
  }

  @Get('devices')
  async list(@CurrentActor() actor: Actor): Promise<DeviceListResponse> {
    return DeviceListResponse.of(await this.devices.list(actor));
  }

  /** 러너 추가: { requestId, name }. run 권한만 가진 기기. 토큰 원문은 이번 응답에만 */
  @Post('devices/runner')
  async addRunner(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<DeviceResponse> {
    return DeviceResponse.of(await this.service.addRunner(actor, AddRunnerInput.from(body)));
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
  ): Promise<DeviceResponse> {
    return DeviceResponse.of(
      await this.service.pairServerRunner(actor, PairServerRunnerInput.from(body), req.ip ?? ''),
    );
  }

  /** 이름·권한 바꾸기: { name?, scopes?, version } */
  @Patch('devices/:id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<DeviceResponse> {
    return DeviceResponse.of(await this.service.update(actor, id, UpdateDeviceInput.from(body)));
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
