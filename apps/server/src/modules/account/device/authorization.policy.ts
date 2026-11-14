import type { SecretBox } from '../../platform';
import { Device } from './device';
import type { AuthorizeInput } from './device.input';
import { ConsentInput } from './device.input';
import { OAuthClient } from './oauth-client';
import { OAuthError } from './oauth-error';

// 승인 요청(GET /oauth/authorize)을 어디로 보낼지 정하는 규칙 (OAuth 2.1).
//   클라이언트나 돌려보낼 주소가 틀리면: 그 주소를 믿을 수 없으므로 돌려보내지 않고 400
//   그 밖의 문제(response_type, PKCE): 돌려보낼 주소에 error를 붙여 돌려보낸다
//   문제가 없으면: 승인 화면(/connect)으로. PKCE는 S256만 받는다
//   ChatGPT·Claude 앱의 주소인데 블로그가 앱 연결을 껐으면: 돌려보내지 않고 400
//   돌려보낼 때는 iss(이 인가 서버 주소)를 붙인다 (RFC 9207)
// 요청한 권한(scope)은 기기 모양의 이름(Device.PROFILES: news · collect · extension)만 본다. 나머지 이름은 보지 않는다:
// 새 기기는 기본 권한이고 넓히기는 관리자가 기기 메뉴에서 한다 (AI 도구가 무엇을 실어 보내든 지금의 연결이 그대로 돈다).
// 모양은 하나만, 다른 권한과 섞지 않는다. news · collect는 이 컴퓨터로 돌아가는 연결만 (앱에 공간의 소식 · 올리기를 내주지 않게),
// extension은 브라우저 확장의 주소(chromiumapp.org)만, 확장의 주소는 extension만 요청한다 (2차 4단계).
export class AuthorizationPolicy {
  /** 요청해도 되는 권한. 그 밖의 이름(offline_access 빼고)과 함께 오면 invalid_scope */
  private static readonly REQUESTABLE: readonly string[] = Object.keys(Device.PROFILES);
  private static readonly EXTENSION = 'extension';
  /** 갱신 토큰을 쓴다는 표시. 권한이 아니라 보지 않는다 */
  private static readonly OFFLINE = 'offline_access';

  constructor(private readonly box: SecretBox) {}

  redirectFor(
    siteUrl: string,
    client: OAuthClient | null,
    req: AuthorizeInput,
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
    const asked = AuthorizationPolicy.namesOf(req.scope);
    const problem = AuthorizationPolicy.scopeProblem(asked, req.redirectUri);
    if (problem)
      return AuthorizationPolicy.back(req.redirectUri, req.state, siteUrl, {
        error: 'invalid_scope',
        error_description: problem,
      });
    const scopes = asked.filter((n) => AuthorizationPolicy.REQUESTABLE.includes(n));
    const sealed = ConsentInput.seal(
      this.box,
      client.clientId,
      client.clientName,
      req.redirectUri,
      req.codeChallenge,
      req.state,
      siteUrl,
      scopes.length > 0 ? scopes : null,
    );
    return `${siteUrl}/connect?request=${encodeURIComponent(sealed)}`;
  }

  /** 요청한 권한의 이름들 (offline_access 빼고) */
  private static namesOf(scope: string | null): readonly string[] {
    return [...new Set((scope ?? '').split(/\s+/))].filter(
      (n) => n && n !== AuthorizationPolicy.OFFLINE,
    );
  }

  /** 요청한 권한으로 연결할 수 없는 까닭. 기기 모양을 요청하지 않은 이 컴퓨터 · 앱의 연결은 늘 null (다른 이름은 보지 않는다) */
  private static scopeProblem(names: readonly string[], redirectUri: string): string | null {
    const extension = OAuthClient.isExtension(redirectUri);
    const [asked] = names.filter((n) => AuthorizationPolicy.REQUESTABLE.includes(n));
    if (asked === undefined) return extension ? '브라우저 확장은 extension 권한을 요청해요' : null;
    if (names.length > 1) return `${asked} 권한은 다른 권한과 함께 요청할 수 없어요`;
    if (asked === AuthorizationPolicy.EXTENSION)
      return extension ? null : 'extension 권한은 브라우저 확장만 요청할 수 있어요';
    if (extension || OAuthClient.appOf(redirectUri))
      return `${asked} 권한은 이 컴퓨터의 도구만 요청할 수 있어요`;
    return null;
  }

  /** 주인이 거절했을 때 돌려보낼 주소 */
  deniedRedirect(consent: ConsentInput): string {
    return AuthorizationPolicy.back(consent.redirectUri, consent.state, consent.issuer, {
      error: 'access_denied',
      error_description: '연결을 거절했어요',
    });
  }

  /** 승인했을 때 돌려보낼 주소 (코드와 state) */
  static approvedRedirect(consent: ConsentInput, code: string): string {
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
