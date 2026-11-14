import { BaseRequest, type ColumnReaders, InvalidRequest, type SecretBox } from '../../platform';
import type { DeviceRow } from '../account.tables';
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
export class RegisterClientInput extends BaseRequest {
  private constructor(
    readonly clientName: string,
    readonly redirectUris: readonly string[],
  ) {
    super();
  }

  static from(raw: unknown): RegisterClientInput {
    return asOAuth('invalid_client_metadata', () =>
      BaseRequest.read(
        raw,
        (f) =>
          new RegisterClientInput(
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
export class AuthorizeInput extends BaseRequest {
  private constructor(
    readonly clientId: string,
    readonly redirectUri: string,
    readonly responseType: string | null,
    readonly codeChallenge: string | null,
    readonly codeChallengeMethod: string | null,
    readonly state: string | null,
    /** 요청한 권한 (빈칸으로 나눈 이름들). 앱이 요청할 수 있는 것은 기기 모양 하나뿐이다 (AuthorizationPolicy) */
    readonly scope: string | null,
  ) {
    super();
  }

  static from(query: unknown): AuthorizeInput {
    return asOAuth('invalid_request', () =>
      BaseRequest.read(
        query,
        (f) =>
          new AuthorizeInput(
            f.text('client_id', 200),
            f.text('redirect_uri', 2000),
            f.optionalText('response_type', 40),
            f.optionalText('code_challenge', 200),
            f.optionalText('code_challenge_method', 20),
            f.optionalText('state', 1000),
            f.optionalText('scope', 1000),
          ),
      ),
    );
  }
}

/** 토큰 (POST /oauth/token, form): 승인 코드 → 토큰, 또는 갱신 토큰 → 새 토큰 */
export class TokenInput extends BaseRequest {
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

  static from(body: unknown): TokenInput {
    const request = asOAuth('invalid_request', () =>
      BaseRequest.read(
        body,
        (f) =>
          new TokenInput(
            f.text('grant_type', 40),
            f.optionalText('client_id', 200) ?? '',
            f.optionalText('code', 200),
            f.optionalText('redirect_uri', 2000),
            f.optionalText('code_verifier', 200),
            f.optionalText('refresh_token', 200),
          ),
      ),
    );
    if (request.grantType !== TokenInput.CODE && request.grantType !== TokenInput.REFRESH)
      throw new OAuthError(
        'unsupported_grant_type',
        `지원하지 않는 grant_type이에요: ${request.grantType}`,
      );
    if (
      request.grantType === TokenInput.CODE &&
      (!request.code || !request.codeVerifier || !request.redirectUri)
    )
      throw new OAuthError('invalid_request', 'code, code_verifier, redirect_uri가 필요해요');
    if (request.grantType === TokenInput.REFRESH && !request.refreshToken)
      throw new OAuthError('invalid_request', 'refresh_token이 필요해요');
    return request;
  }
}

/** 토큰 무효로 하기 (RFC 7009) */
export class RevokeTokenInput extends BaseRequest {
  private constructor(readonly token: string) {
    super();
  }

  static from(body: unknown): RevokeTokenInput {
    return asOAuth('invalid_request', () =>
      BaseRequest.read(body, (f) => new RevokeTokenInput(f.text('token', 300))),
    );
  }
}

/**
 * 승인 화면에 걸린 요청. 승인을 기다리는 동안의 값(어느 도구, 어디로 돌려보낼지, PKCE)을 DB에 두지 않고
 * 서버 키로 암호화해 승인 화면 주소에 싣는다 (10분). 주인이 연결·거절을 누르면 이 값을 그대로 돌려받는다.
 */
export class ConsentInput extends BaseRequest {
  static readonly SECONDS = 600;
  /** 승인 요청의 용도 (SecretBox.pack): 승인 요청이 로그인 쿠키 같은 다른 자리에서 풀리지 않게 */
  private static readonly PURPOSE = 'oauth-consent';

  private constructor(
    readonly clientId: string,
    readonly clientName: string,
    readonly redirectUri: string,
    readonly codeChallenge: string,
    readonly state: string | null,
    readonly name: string,
    /** 인가 서버 주소. 돌려보낼 때 iss로 붙인다 (RFC 9207, 다른 서버의 응답과 섞이지 않게) */
    readonly issuer: string,
    /** 앱이 요청한 기기 모양 (news · collect · extension). 없으면 null: 새 기기는 기본 권한 */
    readonly scopes: readonly string[] | null,
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
    scopes: readonly string[] | null,
  ): string {
    return box.pack(
      ConsentInput.PURPOSE,
      JSON.stringify({ clientId, clientName, redirectUri, codeChallenge, state, issuer, scopes }),
      ConsentInput.SECONDS,
    );
  }

  /** raw: { request, name? } — request는 승인 화면 주소의 ?request= 값 */
  static from(raw: unknown, box: SecretBox): ConsentInput {
    return BaseRequest.read(raw, (f) => {
      const opened = box.unpack(ConsentInput.PURPOSE, f.text('request', 4000));
      if (!opened) f.reject('request', '승인 요청이 만료됐어요. AI 도구에서 다시 연결해 주세요');
      const v = (opened ? JSON.parse(opened) : {}) as Record<string, unknown>;
      return new ConsentInput(
        String(v.clientId ?? ''),
        String(v.clientName ?? ''),
        String(v.redirectUri ?? ''),
        String(v.codeChallenge ?? ''),
        typeof v.state === 'string' ? v.state : null,
        f.optionalText('name', 60) ?? String(v.clientName ?? ''),
        String(v.issuer ?? ''),
        Array.isArray(v.scopes) ? v.scopes.map(String) : null,
      );
    });
  }
}

/** 러너 추가: { requestId, name } */
export class AddRunnerInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly name: string,
  ) {
    super();
  }

  static from(raw: unknown): AddRunnerInput {
    return BaseRequest.read(
      raw,
      (f) => new AddRunnerInput(f.text('requestId', 200), f.text('name', 60)),
    );
  }
}

/** POST /api/devices/server-runner: 서버 러너가 내미는 연결 값 (볼륨의 파일) */
export class PairServerRunnerInput extends BaseRequest {
  private constructor(readonly secret: string) {
    super();
  }

  static from(raw: unknown): PairServerRunnerInput {
    return BaseRequest.read(raw, (f) => new PairServerRunnerInput(f.text('secret', 200)));
  }
}

/** POST /api/devices/code-runner: 코드 러너 칸의 연결 값과 칸 번호 (1~99) */
export class PairCodeRunnerInput extends BaseRequest {
  private static readonly SLOT = /^[1-9][0-9]?$/;

  private constructor(
    readonly secret: string,
    readonly slot: string,
  ) {
    super();
  }

  static from(raw: unknown): PairCodeRunnerInput {
    return BaseRequest.read(raw, (f) => {
      const slot = f.text('slot', 2);
      if (slot && !PairCodeRunnerInput.SLOT.test(slot)) f.reject('slot', '칸 번호는 1~99예요');
      return new PairCodeRunnerInput(f.text('secret', 200), slot);
    });
  }
}

/** 주인이 바꾸는 칸. 칸 하나에 한 줄이다. 보내지 않거나 비운 칸은 그대로 둔다 */
const COLUMNS: ColumnReaders<DeviceRow> = {
  name: (f, n) => f.optionalText(n, 60) ?? undefined,
  scopes: (f, n) => f.optionalTextList(n, 10, 40) ?? undefined,
};

/** PATCH /api/devices/:id: 기기 이름·권한 바꾸기. version은 화면이 불러올 때 받은 값 */
export class UpdateDeviceInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly changes: Partial<DeviceRow>,
    readonly version: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateDeviceInput {
    return BaseRequest.read(raw, (f) => new UpdateDeviceInput(id, f.columns(COLUMNS), f.version()));
  }
}
