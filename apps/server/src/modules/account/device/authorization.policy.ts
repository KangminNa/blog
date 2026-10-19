import type { SecretBox } from '../../platform';
import type { AuthorizeRequest } from './device.request';
import { ConsentRequest } from './device.request';
import { OAuthClient } from './oauth-client';
import { OAuthError } from './oauth-error';

// 승인 요청(GET /oauth/authorize)을 어디로 보낼지 정하는 규칙 (OAuth 2.1).
//   클라이언트나 돌려보낼 주소가 틀리면: 그 주소를 믿을 수 없으므로 돌려보내지 않고 400
//   그 밖의 문제(response_type, PKCE): 돌려보낼 주소에 error를 붙여 돌려보낸다
//   문제가 없으면: 승인 화면(/connect)으로. PKCE는 S256만 받는다
//   ChatGPT·Claude 앱의 주소인데 블로그가 앱 연결을 껐으면: 돌려보내지 않고 400
//   돌려보낼 때는 iss(이 인가 서버 주소)를 붙인다 (RFC 9207)
export class AuthorizationPolicy {
  constructor(private readonly box: SecretBox) {}

  redirectFor(
    siteUrl: string,
    client: OAuthClient | null,
    req: AuthorizeRequest,
    hostedApps: boolean,
  ): string {
    if (!client) throw new OAuthError('invalid_client', '등록되지 않은 클라이언트예요');
    if (!client.allows(req.redirectUri))
      throw new OAuthError('invalid_request', 'redirect_uri가 등록한 주소와 달라요');
    OAuthClient.assertAppAllowed(req.redirectUri, hostedApps, 'invalid_request');
    if (req.responseType !== 'code')
      return AuthorizationPolicy.back(req.redirectUri, req.state, siteUrl, {
        error: 'unsupported_response_type',
        error_description: 'response_type은 code만 받아요',
      });
    if (!req.codeChallenge || req.codeChallengeMethod !== 'S256')
      return AuthorizationPolicy.back(req.redirectUri, req.state, siteUrl, {
        error: 'invalid_request',
        error_description: 'PKCE(code_challenge, S256)가 필요해요',
      });
    const sealed = ConsentRequest.seal(
      this.box,
      client.clientId,
      client.clientName,
      req.redirectUri,
      req.codeChallenge,
      req.state,
      siteUrl,
    );
    return `${siteUrl}/connect?request=${encodeURIComponent(sealed)}`;
  }

  /** 주인이 거절했을 때 돌려보낼 주소 */
  deniedRedirect(consent: ConsentRequest): string {
    return AuthorizationPolicy.back(consent.redirectUri, consent.state, consent.issuer, {
      error: 'access_denied',
      error_description: '연결을 거절했어요',
    });
  }

  /** 승인했을 때 돌려보낼 주소 (코드와 state) */
  static approvedRedirect(consent: ConsentRequest, code: string): string {
    return AuthorizationPolicy.back(consent.redirectUri, consent.state, consent.issuer, { code });
  }

  private static back(
    redirectUri: string,
    state: string | null,
    issuer: string,
    values: Readonly<Record<string, string>>,
  ): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
    if (state) url.searchParams.set('state', state);
    if (issuer) url.searchParams.set('iss', issuer);
    return url.toString();
  }
}
