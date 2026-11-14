import { randomBytes } from 'node:crypto';
import { BaseEntity } from '../../platform';
import type { OauthClientNew, OauthClientRow } from '../account.tables';
import { OAuthClientView } from './device.view';
import { OAuthError } from './oauth-error';

// AI 도구(Claude Code 등)가 스스로 등록한 OAuth 클라이언트 (동적 등록, RFC 7591). 비밀값이 없는 공개 클라이언트다.
// 돌려보낼 주소는 셋만 받는다.
//   이 컴퓨터(localhost · 127.0.0.1 · [::1]): Claude Code · Codex 등. 남이 보낸 승인 링크를 눌러도 열쇠(승인 코드)는
//     내 컴퓨터로만 가서 그 사람이 가져갈 수 없다.
//   ChatGPT · Claude 앱의 정해진 주소: 블로그에서 "앱 연결 허용"을 켰을 때만 (SpaceView.hostedApps).
//   브라우저 확장의 주소(https://<확장 id 32자>.chromiumapp.org/, 2차 4단계): 브라우저가 그 확장에게만 넘기는 주소라
//     이 컴퓨터와 같다 (chrome.identity.launchWebAuthFlow). 확장은 extension 권한만 요청한다 (AuthorizationPolicy).
// 열쇠가 id가 아니라 client_id이고 고치지 않는 행이라 TableEntity가 아니라 BaseEntity다.
export class OAuthClient extends BaseEntity {
  private constructor(private readonly row: OauthClientNew) {
    super(row.client_id, 1);
  }

  /** [앱 이름, 그 앱이 열쇠를 돌려받는 주소]. 공식 문서의 주소 그대로 */
  private static readonly HOSTED: ReadonlyArray<readonly [string, RegExp]> = [
    ['Claude', /^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/],
    ['ChatGPT', /^https:\/\/chatgpt\.com\/connector_platform_oauth_redirect$/],
    ['ChatGPT', /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/],
  ];

  /** 브라우저 확장이 열쇠를 돌려받는 주소. 확장 id는 a~p 32자 */
  private static readonly EXTENSION = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/;

  /** 돌려보낼 주소가 브라우저 확장의 것인가 */
  static isExtension(redirectUri: string): boolean {
    return OAuthClient.EXTENSION.test(redirectUri);
  }

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
    return new OAuthClient({
      client_id: `cairn_${randomBytes(16).toString('hex')}`,
      space_id: spaceId,
      client_name: clientName.trim().slice(0, 80) || 'AI 도구',
      redirect_uris: redirectUris,
    });
  }

  static restore(row: OauthClientRow): OAuthClient {
    return new OAuthClient(row);
  }

  get clientId(): string {
    return this.row.client_id;
  }

  get clientName(): string {
    return this.row.client_name ?? '';
  }

  /** 저장할 행. Repository가 부른다 */
  get unsaved(): Readonly<OauthClientNew> {
    return this.row;
  }

  /** 등록할 때 적은 주소와 글자 하나까지 같아야 한다 */
  allows(redirectUri: string): boolean {
    return (this.row.redirect_uris ?? []).includes(redirectUri);
  }

  /** 등록 결과 */
  view(): OAuthClientView {
    return new OAuthClientView(this.row);
  }

  /** 앱의 주소인데 블로그가 앱 연결을 허용하지 않았으면 */
  static assertAppAllowed(redirectUri: string, hostedApps: boolean, error: string): void {
    if (OAuthClient.appOf(redirectUri) && !hostedApps)
      throw new OAuthError(
        error,
        'ChatGPT·Claude 앱 연결이 꺼진 블로그예요. 관리 화면 기기 화면에서 켜 주세요',
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
    if (OAuthClient.isExtension(uri)) return;
    if (!loopback || (url.protocol !== 'http:' && url.protocol !== 'https:'))
      throw new OAuthError(
        'invalid_redirect_uri',
        `돌려보낼 주소는 이 컴퓨터(http://localhost) · 브라우저 확장 · ChatGPT·Claude 앱만 쓸 수 있어요: ${uri}`,
      );
  }
}
