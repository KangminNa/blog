import { randomBytes } from 'node:crypto';
import { BaseEntity } from '../../platform';
import { OAuthError } from './oauth-error';

// AI 도구(Claude Code 등)가 스스로 등록한 OAuth 클라이언트 (동적 등록, RFC 7591). 비밀값이 없는 공개 클라이언트다.
// 돌려보낼 주소는 https이거나 이 컴퓨터(localhost)만 받는다.
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

  static register(
    spaceId: string,
    clientName: string,
    redirectUris: readonly string[],
  ): OAuthClient {
    if (redirectUris.length === 0 || redirectUris.length > 10)
      throw new OAuthError(
        'invalid_redirect_uri',
        '돌려보낼 주소(redirect_uris)는 1~10개여야 해요',
      );
    for (const uri of redirectUris) OAuthClient.checkRedirect(uri);
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

  private static checkRedirect(uri: string): void {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new OAuthError('invalid_redirect_uri', `주소 모양이 아니에요: ${uri}`);
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.hash) throw new OAuthError('invalid_redirect_uri', `주소에 #를 넣을 수 없어요: ${uri}`);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      throw new OAuthError(
        'invalid_redirect_uri',
        `https 주소이거나 이 컴퓨터(http://localhost)여야 해요: ${uri}`,
      );
  }
}
