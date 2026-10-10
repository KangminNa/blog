import { Actor, BaseResponse } from '../../platform';
import { AuthorizationPolicy } from './authorization.policy';
import type { AuthorizationCode } from './authorization-code';
import { type Device, DeviceCredential } from './device';
import type { ConsentView, DeviceView, OAuthAddressView } from './device.query';
import type { ConsentRequest } from './device.request';
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
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [Actor.UPLOAD, Actor.READ_PUBLIC, Actor.READ_ALL, Actor.TIDY, Actor.WRITE],
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

/** 승인 화면 */
export class ConsentResponse extends BaseResponse {
  private constructor(private readonly view: ConsentView) {
    super();
  }

  static of(view: ConsentView): ConsentResponse {
    return new ConsentResponse(view);
  }

  toJSON(): object {
    return {
      clientName: this.view.clientName,
      redirectHost: this.view.redirectHost,
      name: this.view.name,
      scopes: this.view.scopes,
    };
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
  static approved(request: ConsentRequest, code: AuthorizationCode): ConsentResultResponse {
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
    return {
      devices: this.devices.map((d) => ({
        id: d.id,
        name: d.name,
        client: d.clientName,
        scopes: d.scopes,
        createdAt: d.createdAt.toISOString(),
        lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
        revokedAt: d.revokedAt?.toISOString() ?? null,
        version: d.version,
      })),
    };
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
