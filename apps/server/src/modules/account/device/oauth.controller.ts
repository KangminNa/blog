import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { type Actor, CurrentActor, type HttpRequest, type HttpResponse } from '../../platform';
import { DeviceQuery } from './device.query';
import {
  AuthorizeRequest,
  RegisterClientRequest,
  RevokeTokenRequest,
  TokenRequest,
} from './device.request';
import {
  AuthorizationServerResponse,
  ClientRegisteredResponse,
  EmptyResponse,
  ProtectedResourceResponse,
  TokenResponse,
} from './device.response';
import { DeviceService } from './device.service';

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
  async authorizationServer(@CurrentActor() actor: Actor): Promise<AuthorizationServerResponse> {
    return AuthorizationServerResponse.of(await this.devices.addresses(actor));
  }

  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp'])
  async protectedResource(@CurrentActor() actor: Actor): Promise<ProtectedResourceResponse> {
    return ProtectedResourceResponse.of(await this.devices.addresses(actor));
  }

  @Post('oauth/register')
  async register(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Body() body: unknown,
  ): Promise<ClientRegisteredResponse> {
    return ClientRegisteredResponse.of(
      await this.service.registerClient(actor, RegisterClientRequest.from(body), req.ip ?? ''),
    );
  }

  @Get('oauth/authorize')
  async authorize(
    @CurrentActor() actor: Actor,
    @Req() req: HttpRequest,
    @Res() res: HttpResponse,
  ): Promise<void> {
    res.redirect(
      302,
      await this.devices.authorizeRedirect(actor, AuthorizeRequest.from(req.query)),
    );
  }

  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Post('oauth/token')
  async token(@Body() body: unknown): Promise<TokenResponse> {
    return TokenResponse.of(await this.service.token(TokenRequest.from(body)));
  }

  @HttpCode(200)
  @Post('oauth/revoke')
  async revoke(@Body() body: unknown): Promise<EmptyResponse> {
    await this.service.revokeToken(RevokeTokenRequest.from(body));
    return new EmptyResponse();
  }
}
