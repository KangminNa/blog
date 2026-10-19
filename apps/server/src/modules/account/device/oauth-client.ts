import { randomBytes } from 'node:crypto';
import { BaseEntity } from '../../platform';
import { OAuthError } from './oauth-error';

// AI 도구(Claude Code 등)가 스스로 등록한 OAuth 클라이언트 (동적 등록, RFC 7591). 비밀값이 없는 공개 클라이언트다.
// 돌려보낼 주소는 둘만 받는다.
//   이 컴퓨터(localhost · 127.0.0.1 · [::1]): Claude Code · Codex 등. 남이 보낸 승인 링크를 눌러도 열쇠(승인 코드)는
//     내 컴퓨터로만 가서 그 사람이 가져갈 수 없다.
//   ChatGPT · Claude 앱의 정해진 주소: 블로그에서 "앱 연결 허용"을 켰을 때만 (Space.hostedApps).
export class OAuthClient extends BaseEntity {
  private constructor(
    readonly clientId: string,
    readonly spaceId: string,
    readonly clientName: string,
    readonly redirectUris: readonly string[],
    readonly isNew: boolean,
  ) {
    super(clientId, 1);
  }

  /** [앱 이름, 그 앱이 열쇠를 돌려받는 주소]. 공식 문서의 주소 그대로 */
  private static readonly HOSTED: ReadonlyArray<readonly [string, RegExp]> = [
    ['Claude', /^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/],
    ['ChatGPT', /^https:\/\/chatgpt\.com\/connector_platform_oauth_redirect$/],
    ['ChatGPT', /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/],
  ];

  /** 돌려보낼 주소가 ChatGPT·Claude 앱의 것이면 그 앱 이름 */
  static appOf(redirectUri: string): string | null {
    return OAuthClient.HOSTED.find(([, pattern]) => pattern.test(redirectUri))?.[0] ?? null;
  }

  /** hostedApps: 블로그가 ChatGPT·Claude 앱 연결을 허용했는가 */
  static register(
    spaceId: string,
    clientName: string,
    redirectUris: readonly string[],
    hostedApps: boolean,
  ): OAuthClient {
    if (redirectUris.length === 0 || redirectUris.length > 10)
      throw new OAuthError(
        'invalid_redirect_uri',
        '돌려보낼 주소(redirect_uris)는 1~10개여야 해요',
      );
    for (const uri of redirectUris) OAuthClient.checkRedirect(uri, hostedApps);
    const name = clientName.trim().slice(0, 80) || 'AI 도구';
    return new OAuthClient(
      `cairn_${randomBytes(16).toString('hex')}`,
      spaceId,
      name,
      redirectUris,
      true,
    );
  }

  static restore(
    clientId: string,
    spaceId: string,
    clientName: string,
    redirectUris: readonly string[],
  ): OAuthClient {
    return new OAuthClient(clientId, spaceId, clientName, redirectUris, false);
  }

  /** 등록할 때 적은 주소와 글자 하나까지 같아야 한다 */
  allows(redirectUri: string): boolean {
    return this.redirectUris.includes(redirectUri);
  }

  /** 앱의 주소인데 블로그가 앱 연결을 허용하지 않았으면 */
  static assertAppAllowed(redirectUri: string, hostedApps: boolean, error: string): void {
    if (OAuthClient.appOf(redirectUri) && !hostedApps)
      throw new OAuthError(
        error,
        'ChatGPT·Claude 앱 연결이 꺼진 블로그예요. 관리 화면 기기 시트에서 켜 주세요',
      );
  }

  private static checkRedirect(uri: string, hostedApps: boolean): void {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new OAuthError('invalid_redirect_uri', `주소 모양이 아니에요: ${uri}`);
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.hash) throw new OAuthError('invalid_redirect_uri', `주소에 #를 넣을 수 없어요: ${uri}`);
    if (OAuthClient.appOf(uri)) {
      OAuthClient.assertAppAllowed(uri, hostedApps, 'invalid_redirect_uri');
      return;
    }
    if (!loopback || (url.protocol !== 'http:' && url.protocol !== 'https:'))
      throw new OAuthError(
        'invalid_redirect_uri',
        `돌려보낼 주소는 이 컴퓨터(http://localhost)나 ChatGPT·Claude 앱만 쓸 수 있어요: ${uri}`,
      );
  }
}
