import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { WebSession } from '../owner/owner';
import { CreateOwnerRequest } from '../owner/owner.request';
import { LoginResponse } from '../owner/owner.response';
import { OwnerService } from '../owner/owner.service';
import { InstallPolicy } from './install.policy';
import { SpaceQuery } from './space.query';
import { InstallCodeRequest } from './space.request';
import { InstallPassResponse, InstallStatusResponse } from './space.response';
import { SpaceService } from './space.service';

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
      InstallCodeRequest.from(body),
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
      CreateOwnerRequest.from(body),
      req.ip ?? '',
      String(req.headers['user-agent'] ?? ''),
    );
    Cookies.set(res, req, WebSession.COOKIE, session.token ?? '', WebSession.DAYS * 86_400);
    Cookies.clear(res, InstallPolicy.COOKIE);
    return new LoginResponse();
  }
}
