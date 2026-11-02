import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest, type HttpResponse } from '../../platform';
import { AuthorizeInput, RegisterClientInput, RevokeTokenInput, TokenInput } from './device.input';
import { DeviceQuery } from './device.query';
import { DeviceService } from './device.service';
import type {
  AuthorizationServerView,
  OAuthClientView,
  ProtectedResourceView,
  TokenView,
} from './device.view';

// MCP 인증 (OAuth 2.1). AI 도구(Claude Code 등)가 이 순서로 붙는다:
//   /mcp가 401 → 안내 문서 두 개 → 스스로 등록 → 브라우저로 승인(주인이 /connect에서 연결) → 코드를 토큰으로 → /mcp
// 경로는 OAuth 표준 그대로라 /api 아래가 아니다.
@Controller()
export class OAuthController {
  constructor(
    private readonly devices: DeviceQuery,
    private readonly service: DeviceService,
  ) {}

  @Get('.well-known/oauth-authorization-server')
  authorizationServer(@CurrentActor() actor: Actor): Promise<AuthorizationServerView> {
    return this.devices.authorizationServer(actor);
  }

  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp'])
  protectedResource(@CurrentActor() actor: Actor): Promise<ProtectedResourceView> {
    return this.devices.protectedResource(actor);
  }

  @Post('oauth/register')
  async register(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Body() body: unknown,
  ): Promise<OAuthClientView> {
    const input = RegisterClientInput.from(body);
    return (await this.service.registerClient(actor, input, req.ip ?? '')).view();
  }

  @Get('oauth/authorize')
  async authorize(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    res.redirect(302, await this.devices.authorizeRedirect(actor, AuthorizeInput.from(req.query)));
  }

  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Post('oauth/token')
  async token(@Body() body: unknown): Promise<TokenView> {
    return (await this.service.token(TokenInput.from(body))).tokenView();
  }

  /** 응답 본문 없이 성공 */
  @HttpCode(200)
  @Post('oauth/revoke')
  async revoke(@Body() body: unknown): Promise<object> {
    await this.service.revokeToken(RevokeTokenInput.from(body));
    return {};
  }
}
