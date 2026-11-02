import type { DeviceRow, OauthClientRow } from '../account.tables';

// 기기의 읽기 모양. 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.
// 토큰 해시는 어떤 View에도 없다. 토큰 원문은 만든 순간의 응답에만 실린다 (DeviceView의 token, TokenView).

/** 기기 하나를 바꾼 결과. 예비 기기 토큰을 만들었으면 원문을 이번 한 번만 */
export class DeviceView {
  constructor(
    private readonly row: Readonly<DeviceRow>,
    private readonly token: string | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      scopes: r.scopes,
      revokedAt: r.revoked_at?.toISOString() ?? null,
      version: r.version,
      ...(this.token ? { token: this.token } : {}),
    };
  }
}

/** 기기 목록의 하나 (관리 화면의 기기 화면) */
export class DeviceListItem {
  constructor(private readonly row: Readonly<DeviceRow & { last_used: Date | null }>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      client: (r.meta as { clientName?: string }).clientName ?? '',
      scopes: r.scopes,
      createdAt: r.created_at.toISOString(),
      lastUsedAt: r.last_used?.toISOString() ?? null,
      revokedAt: r.revoked_at?.toISOString() ?? null,
      version: r.version,
    };
  }
}

/** 관리 화면의 기기 목록 */
export class DeviceListView {
  constructor(private readonly devices: readonly DeviceListItem[]) {}

  toJSON() {
    return { devices: this.devices.map((d) => d.toJSON()) };
  }
}

/** 승인 화면에 보일 것 */
export class ConsentView {
  constructor(
    private readonly clientName: string,
    private readonly redirectHost: string,
    private readonly name: string,
    private readonly scopes: readonly string[],
    /** ChatGPT·Claude 앱의 연결이면 그 앱 이름 (승인 화면이 직접 시작한 연결인지 묻는다) */
    private readonly app: string | null,
  ) {}

  toJSON() {
    return {
      clientName: this.clientName,
      redirectHost: this.redirectHost,
      name: this.name,
      scopes: this.scopes,
      app: this.app,
    };
  }
}

/** 승인·거절 뒤 브라우저가 갈 곳 (AI 도구가 기다리는 주소) */
export class ConsentResultView {
  constructor(private readonly redirect: string) {}

  toJSON() {
    return { redirect: this.redirect };
  }
}

/** OAuth 안내 문서(메타데이터)를 만들 때 쓰는 주소들 */
export class OAuthAddressView {
  constructor(readonly siteUrl: string) {}

  get issuer(): string {
    return this.siteUrl;
  }

  get resource(): string {
    return `${this.siteUrl}/mcp`;
  }
}

/** 인가 서버 안내 (RFC 8414). AI 도구가 어디로 등록·승인·토큰 요청을 보낼지 여기서 안다 */
export class AuthorizationServerView {
  constructor(
    private readonly at: OAuthAddressView,
    private readonly scopes: readonly string[],
  ) {}

  toJSON() {
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
      scopes_supported: [...this.scopes, 'offline_access'],
    };
  }
}

/** 보호된 자원 안내 (RFC 9728): /mcp는 이 인가 서버의 토큰으로 연다 */
export class ProtectedResourceView {
  constructor(private readonly at: OAuthAddressView) {}

  toJSON() {
    return {
      resource: this.at.resource,
      authorization_servers: [this.at.issuer],
      bearer_methods_supported: ['header'],
      resource_name: 'Cairn',
    };
  }
}

/** 동적 등록 결과 (RFC 7591). 공개 클라이언트라 비밀값은 없다 */
export class OAuthClientView {
  constructor(
    private readonly row: Readonly<Pick<OauthClientRow, 'client_id' | 'redirect_uris'>>,
    private readonly clientName: string,
  ) {}

  toJSON() {
    return {
      client_id: this.row.client_id,
      client_name: this.clientName,
      redirect_uris: this.row.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
  }
}

/** 토큰 (RFC 6749). 원문은 이 응답에만 나간다 */
export class TokenView {
  constructor(
    private readonly accessToken: string | null,
    private readonly refreshToken: string | null,
    private readonly scopes: readonly string[],
  ) {}

  toJSON() {
    return {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: this.scopes.join(' '),
    };
  }
}
