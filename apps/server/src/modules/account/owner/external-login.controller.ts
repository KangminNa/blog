import { Controller, Delete, Get, Param, Req, Res } from '@nestjs/common';
import {
  type Actor,
  Cookies,
  CurrentActor,
  DomainError,
  type HttpRequest,
  type HttpResponse,
  SecretBox,
} from '../../platform';
import { ExternalLoginQuery } from './external-login.query';
import { ExternalCallbackRequest, ExternalStartRequest } from './external-login.request';
import {
  LoginLinksResponse,
  LoginMethodsResponse,
  UnlinkedResponse,
} from './external-login.response';
import { WebSession } from './owner';
import { OwnerService } from './owner.service';

// 외부 로그인 (로그인 플러그인: GitHub 등). 코어가 경로·확인값·로그인 쿠키를 맡고, 플러그인은 누구인지만 알려준다.
//   GET    api/auth/methods                    로그인 화면의 버튼들
//   GET    api/auth/login/:method/start         연결해 둔 계정으로 로그인 시작
//   GET    api/auth/login/:method/callback      그 서비스가 돌려보내는 곳 (로그인·연결 함께)
//   GET    api/auth/links                       주인에게 연결된 계정들
//   GET    api/auth/links/:method/start         로그인한 주인이 계정 연결 시작
//   DELETE api/auth/links/:method               연결 끊기
@Controller('api/auth')
export class ExternalLoginController {
  constructor(
    private readonly external: ExternalLoginQuery,
    private readonly owners: OwnerService,
    private readonly box: SecretBox,
  ) {}

  @Get('methods')
  methods(@CurrentActor() actor: Actor): LoginMethodsResponse {
    return LoginMethodsResponse.of(this.external.methods(actor));
  }

  @Get('login/:method/start')
  async login(
    @CurrentActor() actor: Actor,
    @Param('method') method: string,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    await this.start(
      actor,
      ExternalStartRequest.from(method, ExternalStartRequest.LOGIN, req.query),
      req,
      res,
    );
  }

  @Get('links/:method/start')
  async link(
    @CurrentActor() actor: Actor,
    @Param('method') method: string,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    await this.start(
      actor,
      ExternalStartRequest.from(method, ExternalStartRequest.LINK, req.query),
      req,
      res,
    );
  }

  /**
   * 돌아온 곳. 브라우저가 직접 여는 주소라 실패도 JSON 대신 화면으로 돌려보낸다:
   * 로그인 실패는 /login?error=…, 연결 실패는 돌아갈 곳?error=…
   */
  @Get('login/:method/callback')
  async callback(
    @CurrentActor() actor: Actor,
    @Param('method') method: string,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    const request = ExternalCallbackRequest.from(
      method,
      req.query,
      Cookies.read(req, ExternalCallbackRequest.COOKIE),
      this.box,
    );
    Cookies.clear(res, ExternalCallbackRequest.COOKIE);
    try {
      const session = await this.owners.finishExternal(
        actor,
        request,
        req.ip ?? '',
        String(req.headers['user-agent'] ?? ''),
      );
      if (session)
        Cookies.set(res, req, WebSession.COOKIE, session.token ?? '', WebSession.DAYS * 86_400);
      res.redirect(302, request.returnTo);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const back = request.isLink ? request.returnTo : '/login';
      const join = back.includes('?') ? '&' : '?';
      res.redirect(302, `${back}${join}error=${encodeURIComponent(error.message)}`);
    }
  }

  @Get('links')
  async links(@CurrentActor() actor: Actor): Promise<LoginLinksResponse> {
    return LoginLinksResponse.of(await this.external.links(actor));
  }

  @Delete('links/:method')
  async unlink(
    @CurrentActor() actor: Actor,
    @Param('method') method: string,
  ): Promise<UnlinkedResponse> {
    await this.owners.unlink(actor, method);
    return new UnlinkedResponse();
  }

  private async start(
    actor: Actor,
    request: ExternalStartRequest,
    req: HttpRequest,
    res: HttpResponse,
  ): Promise<void> {
    const view = await this.external.start(actor, request);
    Cookies.set(
      res,
      req,
      ExternalCallbackRequest.COOKIE,
      view.cookie,
      ExternalCallbackRequest.SECONDS,
    );
    res.redirect(302, view.url);
  }
}
