import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  Actor,
  BaseResponse,
  CurrentActor,
  type HttpRequest,
  type HttpResponse,
} from '../../platform';
import { type Device, DeviceCredential } from './device';
import { AuthorizeInput, RegisterClientInput, RevokeTokenInput, TokenInput } from './device.input';
import { DeviceQuery } from './device.query';
import { DeviceService } from './device.service';
import type { OAuthAddressView } from './device.view';
import type { OAuthClient } from './oauth-client';

/** 인가 서버 안내 (RFC 8414). AI 도구가 어디로 등록·승인·토큰 요청을 보낼지 여기서 안다 */
export class AuthorizationServerResponse extends BaseResponse {
  private constructor(private readonly at: OAuthAddressView) {
    super();
  }

  static of(at: OAuthAddressView): AuthorizationServerResponse {
    return new AuthorizationServerResponse(at);
  }

  toJSON(): object {
    const site = this.at.siteUrl;
    return {
      issuer: this.at.issuer,
      authorization_endpoint: `${site}/oauth/authorize`,
      token_endpoint: `${site}/oauth/token`,
      registration_endpoint: `${site}/oauth/register`,
      revocation_endpoint: `${site}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
      // offline_access: 갱신 토큰을 쓴다는 표시 (Claude Code는 이것이 있어야 다시 로그인하지 않고 갱신한다)
      scopes_supported: [
        Actor.UPLOAD,
        Actor.READ_PUBLIC,
        Actor.READ_ALL,
        Actor.TIDY,
        Actor.WRITE,
        Actor.RUN,
        'offline_access',
      ],
    };
  }
}

/** 보호된 자원 안내 (RFC 9728): /mcp는 이 인가 서버의 토큰으로 연다 */
export class ProtectedResourceResponse extends BaseResponse {
  private constructor(private readonly at: OAuthAddressView) {
    super();
  }

  static of(at: OAuthAddressView): ProtectedResourceResponse {
    return new ProtectedResourceResponse(at);
  }

  toJSON(): object {
    return {
      resource: this.at.resource,
      authorization_servers: [this.at.issuer],
      bearer_methods_supported: ['header'],
      resource_name: 'Cairn',
    };
  }
}

/** 동적 등록 결과 (RFC 7591). 공개 클라이언트라 비밀값은 없다 */
export class ClientRegisteredResponse extends BaseResponse {
  private constructor(private readonly client: OAuthClient) {
    super();
  }

  static of(client: OAuthClient): ClientRegisteredResponse {
    return new ClientRegisteredResponse(client);
  }

  toJSON(): object {
    return {
      client_id: this.client.clientId,
      client_name: this.client.clientName,
      redirect_uris: this.client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
  }
}

/** 토큰 (RFC 6749). 원문은 이 응답에만 나간다 */
export class TokenResponse extends BaseResponse {
  private constructor(private readonly device: Device) {
    super();
  }

  static of(device: Device): TokenResponse {
    return new TokenResponse(device);
  }

  toJSON(): object {
    return {
      access_token: this.device.issuedToken(DeviceCredential.ACCESS)?.token,
      refresh_token: this.device.issuedToken(DeviceCredential.REFRESH)?.token,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: this.device.scopes.join(' '),
    };
  }
}

/** 응답 본문 없이 성공 */
export class EmptyResponse extends BaseResponse {
  toJSON(): object {
    return {};
  }
}

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
      await this.service.registerClient(actor, RegisterClientInput.from(body), req.ip ?? ''),
    );
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
  async token(@Body() body: unknown): Promise<TokenResponse> {
    return TokenResponse.of(await this.service.token(TokenInput.from(body)));
  }

  @HttpCode(200)
  @Post('oauth/revoke')
  async revoke(@Body() body: unknown): Promise<EmptyResponse> {
    await this.service.revokeToken(RevokeTokenInput.from(body));
    return new EmptyResponse();
  }
}
