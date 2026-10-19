import { BaseRequest, InvalidRequest, type SecretBox } from '../../platform';
import { OAuthError } from './oauth-error';

/** BaseRequest가 모은 모양 오류를 OAuth 오류 모양으로 (AI 도구는 OAuth 모양만 읽는다) */
function asOAuth<R>(code: string, read: () => R): R {
  try {
    return read();
  } catch (error) {
    if (error instanceof InvalidRequest)
      throw new OAuthError(code, [...error.fields].map(([k, v]) => `${k}: ${v}`).join(', '));
    throw error;
  }
}

/** 동적 클라이언트 등록 (RFC 7591): { client_name, redirect_uris: [...] } */
export class RegisterClientRequest extends BaseRequest {
  private constructor(
    readonly clientName: string,
    readonly redirectUris: readonly string[],
  ) {
    super();
  }

  static from(raw: unknown): RegisterClientRequest {
    return asOAuth('invalid_client_metadata', () =>
      BaseRequest.read(
        raw,
        (f) =>
          new RegisterClientRequest(
            f.optionalText('client_name', 200) ?? '',
            f.optionalTextList('redirect_uris', 10, 2000) ?? [],
          ),
      ),
    );
  }
}

/**
 * 승인 요청 (GET /oauth/authorize). client_id와 redirect_uri가 틀리면 그 주소로 돌려보낼 수 없으므로 바로 400,
 * 그 밖의 값은 읽기만 하고 판단은 승인 단계에서 한다 (틀리면 돌려보낼 주소에 error를 붙인다).
 */
export class AuthorizeRequest extends BaseRequest {
  private constructor(
    readonly clientId: string,
    readonly redirectUri: string,
    readonly responseType: string | null,
    readonly codeChallenge: string | null,
    readonly codeChallengeMethod: string | null,
    readonly state: string | null,
  ) {
    super();
  }

  static from(query: unknown): AuthorizeRequest {
    return asOAuth('invalid_request', () =>
      BaseRequest.read(
        query,
        (f) =>
          new AuthorizeRequest(
            f.text('client_id', 200),
            f.text('redirect_uri', 2000),
            f.optionalText('response_type', 40),
            f.optionalText('code_challenge', 200),
            f.optionalText('code_challenge_method', 20),
            f.optionalText('state', 1000),
          ),
      ),
    );
  }
}

/** 토큰 (POST /oauth/token, form): 승인 코드 → 토큰, 또는 갱신 토큰 → 새 토큰 */
export class TokenRequest extends BaseRequest {
  static readonly CODE = 'authorization_code';
  static readonly REFRESH = 'refresh_token';

  private constructor(
    readonly grantType: string,
    readonly clientId: string,
    readonly code: string | null,
    readonly redirectUri: string | null,
    readonly codeVerifier: string | null,
    readonly refreshToken: string | null,
  ) {
    super();
  }

  static from(body: unknown): TokenRequest {
    const request = asOAuth('invalid_request', () =>
      BaseRequest.read(
        body,
        (f) =>
          new TokenRequest(
            f.text('grant_type', 40),
            f.optionalText('client_id', 200) ?? '',
            f.optionalText('code', 200),
            f.optionalText('redirect_uri', 2000),
            f.optionalText('code_verifier', 200),
            f.optionalText('refresh_token', 200),
          ),
      ),
    );
    if (request.grantType !== TokenRequest.CODE && request.grantType !== TokenRequest.REFRESH)
      throw new OAuthError(
        'unsupported_grant_type',
        `지원하지 않는 grant_type이에요: ${request.grantType}`,
      );
    if (
      request.grantType === TokenRequest.CODE &&
      (!request.code || !request.codeVerifier || !request.redirectUri)
    )
      throw new OAuthError('invalid_request', 'code, code_verifier, redirect_uri가 필요해요');
    if (request.grantType === TokenRequest.REFRESH && !request.refreshToken)
      throw new OAuthError('invalid_request', 'refresh_token이 필요해요');
    return request;
  }
}

/** 토큰 무효로 하기 (RFC 7009) */
export class RevokeTokenRequest extends BaseRequest {
  private constructor(readonly token: string) {
    super();
  }

  static from(body: unknown): RevokeTokenRequest {
    return asOAuth('invalid_request', () =>
      BaseRequest.read(body, (f) => new RevokeTokenRequest(f.text('token', 300))),
    );
  }
}

/**
 * 승인 화면에 걸린 요청. 승인을 기다리는 동안의 값(어느 도구, 어디로 돌려보낼지, PKCE)을 DB에 두지 않고
 * 서버 키로 암호화해 승인 화면 주소에 싣는다 (10분). 주인이 연결·거절을 누르면 이 값을 그대로 돌려받는다.
 */
export class ConsentRequest extends BaseRequest {
  static readonly SECONDS = 600;

  private constructor(
    readonly clientId: string,
    readonly clientName: string,
    readonly redirectUri: string,
    readonly codeChallenge: string,
    readonly state: string | null,
    readonly name: string,
    /** 인가 서버 주소. 돌려보낼 때 iss로 붙인다 (RFC 9207, 다른 서버의 응답과 섞이지 않게) */
    readonly issuer: string,
  ) {
    super();
  }

  static seal(
    box: SecretBox,
    clientId: string,
    clientName: string,
    redirectUri: string,
    codeChallenge: string,
    state: string | null,
    issuer: string,
  ): string {
    return box.pack(
      JSON.stringify({ clientId, clientName, redirectUri, codeChallenge, state, issuer }),
      ConsentRequest.SECONDS,
    );
  }

  /** raw: { request, name? } — request는 승인 화면 주소의 ?request= 값 */
  static from(raw: unknown, box: SecretBox): ConsentRequest {
    return BaseRequest.read(raw, (f) => {
      const opened = box.unpack(f.text('request', 4000));
      if (!opened) f.reject('request', '승인 요청이 만료됐어요. AI 도구에서 다시 연결해 주세요');
      const v = (opened ? JSON.parse(opened) : {}) as Record<string, string | null>;
      return new ConsentRequest(
        String(v.clientId ?? ''),
        String(v.clientName ?? ''),
        String(v.redirectUri ?? ''),
        String(v.codeChallenge ?? ''),
        v.state ?? null,
        f.optionalText('name', 60) ?? String(v.clientName ?? ''),
        String(v.issuer ?? ''),
      );
    });
  }
}

/** 기기 이름·권한 바꾸기. version은 화면이 불러올 때 받은 값 */
export class UpdateDeviceRequest extends BaseRequest {
  private constructor(
    readonly name: string | null,
    readonly scopes: readonly string[] | null,
    readonly version: number,
  ) {
    super();
  }

  static from(raw: unknown): UpdateDeviceRequest {
    return BaseRequest.read(
      raw,
      (f) =>
        new UpdateDeviceRequest(
          f.optionalText('name', 60),
          f.optionalTextList('scopes', 10, 40),
          f.integer('version', 1, 2_147_483_647),
        ),
    );
  }
}
