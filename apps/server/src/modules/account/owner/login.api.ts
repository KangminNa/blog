import { Body, Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { WebSession } from './owner';
import { ChangePasswordInput, LoginInput } from './owner.input';
import { OwnerQuery } from './owner.query';
import { OwnerService } from './owner.service';
import { LoggedInView, type OwnerView } from './owner.view';

// 주인 로그인 (아이디·비밀번호). 로그인 쿠키는 httpOnly라 웹 화면의 스크립트가 읽을 수 없다.
@Controller('api/auth')
export class LoginController {
  constructor(
    private readonly owners: OwnerQuery,
    private readonly service: OwnerService,
  ) {}

  @HttpCode(200)
  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<LoggedInView> {
    const session = await this.service.login(
      LoginInput.from(body),
      req.ip ?? '',
      String(req.headers['user-agent'] ?? ''),
    );
    Cookies.set(res, req, WebSession.COOKIE, session.token ?? '', WebSession.DAYS * 86_400);
    return new LoggedInView();
  }

  @Get('me')
  me(@CurrentActor() actor: Actor): Promise<OwnerView> {
    return this.owners.me(actor);
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ): Promise<object> {
    await this.service.logout(actor, Cookies.read(req, WebSession.COOKIE));
    Cookies.clear(res, WebSession.COOKIE);
    return { loggedOut: true };
  }

  /** 비밀번호를 바꿈. 다른 기기의 로그인은 끝났다 */
  @Put('password')
  async password(
    @CurrentActor() actor: Actor,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<object> {
    await this.service.changePassword(
      actor,
      Cookies.read(req, WebSession.COOKIE),
      ChangePasswordInput.from(body),
    );
    return { changed: true, otherSessionsEnded: true };
  }
}
