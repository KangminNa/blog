import { createHash, randomBytes } from 'node:crypto';
import { BaseEntity } from '../../platform';
import type { OauthCodeNew, OauthCodeRow } from '../account.tables';
import { Device } from './device';
import { OAuthError } from './oauth-error';

// 주인이 승인 화면에서 "연결"을 누르면 나가는 일회용 코드. 5분 안에, 한 번만, 같은 클라이언트·같은 주소·
// 맞는 PKCE 확인값(code_verifier)으로만 토큰으로 바꿀 수 있다. 기기는 코드를 바꿀 때 만든다 (그만둔 승인은 기기를 남기지 않음).
// 새 기기의 값(공간, 승인한 주인, 이름, 도구 이름, 앱이 요청해 승인된 권한)은 device_draft에 둔다.
// 열쇠가 id가 아니라 코드의 해시(code_hash)라 TableEntity가 아니라 BaseEntity다.
export class AuthorizationCode extends BaseEntity {
  static readonly TTL_MS = 5 * 60_000;

  private constructor(
    private row: OauthCodeNew,
    /** 만든 순간에만 있는 원문 (주인이 승인한 뒤 AI 도구에게 한 번 돌려준다) */
    readonly code: string | null,
  ) {
    super(row.code_hash, 1);
  }

  static issue(
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    spaceId: string,
    userId: string,
    deviceName: string,
    clientName: string,
    now: Date,
    /** 앱이 요청한 권한 (소식 기기면 [news]). 없으면 null: 기본 권한 */
    scopes: readonly string[] | null = null,
  ): AuthorizationCode {
    const code = randomBytes(32).toString('base64url');
    return new AuthorizationCode(
      {
        code_hash: AuthorizationCode.hash(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        device_draft: { spaceId, userId, name: deviceName, clientName, scopes },
        expires_at: new Date(now.getTime() + AuthorizationCode.TTL_MS),
        used_at: null,
      },
      code,
    );
  }

  static restore(row: OauthCodeRow): AuthorizationCode {
    return new AuthorizationCode(row, null);
  }

  static hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** 저장할 행. Repository가 부른다 */
  get unsaved(): Readonly<OauthCodeNew> {
    return this.row;
  }

  /** 토큰으로 바꾼다. 틀린 곳이 하나라도 있으면 invalid_grant (어디가 틀렸는지는 자세히 알리지 않음) */
  redeem(clientId: string, redirectUri: string, verifier: string, now: Date): void {
    const r = this.row;
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const ok =
      !r.used_at &&
      now.getTime() < r.expires_at.getTime() &&
      clientId === r.client_id &&
      redirectUri === r.redirect_uri &&
      challenge === r.code_challenge;
    if (!ok)
      throw new OAuthError('invalid_grant', '승인 코드가 맞지 않거나, 이미 썼거나, 만료됐어요');
    this.row = { ...r, used_at: now };
  }

  /** 승인한 기기를 만든다 (코드를 토큰으로 바꿀 때) */
  connect(now: Date): Device {
    const draft = (this.row.device_draft ?? {}) as Record<string, unknown>;
    const text = (key: string) => (typeof draft[key] === 'string' ? draft[key] : '');
    return Device.connect(
      text('spaceId'),
      text('userId'),
      text('name'),
      this.row.client_id,
      text('clientName'),
      now,
      Array.isArray(draft.scopes) ? draft.scopes.map(String) : null,
    );
  }
}
