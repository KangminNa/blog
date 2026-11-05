import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  type Actor,
  BaseResponse,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { LoginResponse } from '../owner/login.api';
import { WebSession } from '../owner/owner';
import { CreateOwnerInput } from '../owner/owner.input';
import { OwnerService } from '../owner/owner.service';
import { InstallPolicy } from './install.policy';
import { InstallCodeInput } from './space.input';
import { SpaceQuery } from './space.query';
import { SpaceService } from './space.service';
import type { InstallStatusView } from './space.view';

/** 설치 마법사의 다음 단계 */
export class InstallStatusResponse extends BaseResponse {
  private constructor(private readonly view: InstallStatusView) {
    super();
  }

  static of(view: InstallStatusView): InstallStatusResponse {
    return new InstallStatusResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 설치 코드가 맞음. 통행증은 쿠키로만 나간다 */
export class InstallPassResponse extends BaseResponse {
  private constructor(private readonly seconds: number) {
    super();
  }

  static of(seconds: number): InstallPassResponse {
    return new InstallPassResponse(seconds);
  }

  toJSON(): object {
    return { verified: true, expiresIn: this.seconds };
  }
}

// 설치 마법사: 설치 코드 → 주인 계정 → (블로그 정보는 api/space, 플러그인은 api/plugins) → 첫 기기
@Controller('api/install')
export class InstallController {
  constructor(
    private readonly spaces: SpaceQuery,
    private readonly service: SpaceService,
    private readonly owners: OwnerService,
  ) {}

  @Get()
  async status(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
  ): Promise<InstallStatusResponse> {
    return InstallStatusResponse.of(
      await this.spaces.installStatus(actor, Cookies.read(req, InstallPolicy.COOKIE)),
    );
  }

  @HttpCode(200)
  @Post('verify')
  async verify(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<InstallPassResponse> {
    const pass = await this.service.verifyInstallCode(
      actor,
      InstallCodeInput.from(body),
      req.ip ?? 'unknown',
    );
    Cookies.set(res, req, InstallPolicy.COOKIE, pass, InstallPolicy.PASS_SECONDS);
    return InstallPassResponse.of(InstallPolicy.PASS_SECONDS);
  }

  /** 주인 계정 만들기. 만들면 바로 로그인되고 설치가 끝난다 (통행증은 지운다) */
  @HttpCode(200)
  @Post('owner')
  async owner(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<LoginResponse> {
    const session = await this.owners.create(
      actor,
      Cookies.read(req, InstallPolicy.COOKIE),
      CreateOwnerInput.from(body),
      req.ip ?? '',
      String(req.headers['user-agent'] ?? ''),
    );
    Cookies.set(res, req, WebSession.COOKIE, session.token ?? '', WebSession.DAYS * 86_400);
    Cookies.clear(res, InstallPolicy.COOKIE);
    return new LoginResponse();
  }
}
