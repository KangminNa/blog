import { createHash, randomBytes } from 'node:crypto';
import { BaseEntity } from '../../platform';
import type { OauthCodeNew, OauthCodeRow } from '../account.tables';
import { AuthorizationPolicy } from './authorization.policy';
import { Device } from './device';
import type { ConsentInput } from './device.input';
import { ConsentResultView } from './device.view';
import { OAuthError } from './oauth-error';

// 주인이 승인 화면에서 "연결"을 누르면 나가는 일회용 코드. 5분 안에, 한 번만, 같은 클라이언트·같은 주소·
// 맞는 PKCE 확인값(code_verifier)으로만 토큰으로 바꿀 수 있다. 기기는 코드를 바꿀 때 만든다 (그만둔 승인은 기기를 남기지 않음).
// 표의 기본 키가 code_hash이고 version이 없어 TableEntity를 쓰지 않는다.
export class AuthorizationCode extends BaseEntity {
  static readonly TTL_MS = 5 * 60_000;

  private constructor(
    private row: Readonly<OauthCodeNew>,
    /** 만든 순간에만 있는 원문 (주인이 승인한 뒤 AI 도구에게 한 번 돌려준다) */
    private readonly code: string | null,
  ) {
    super(row.code_hash, 1);
  }

  static issue(
    consent: ConsentInput,
    spaceId: string,
    userId: string,
    now: Date,
  ): AuthorizationCode {
    const code = randomBytes(32).toString('base64url');
    return new AuthorizationCode(
      {
        code_hash: AuthorizationCode.hash(code),
        client_id: consent.clientId,
        redirect_uri: consent.redirectUri,
        code_challenge: consent.codeChallenge,
        device_draft: { spaceId, userId, name: consent.name, clientName: consent.clientName },
        expires_at: new Date(now.getTime() + AuthorizationCode.TTL_MS),
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
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const ok =
      !this.row.used_at &&
      now.getTime() < this.row.expires_at.getTime() &&
      clientId === this.row.client_id &&
      redirectUri === this.row.redirect_uri &&
      challenge === this.row.code_challenge;
    if (!ok)
      throw new OAuthError('invalid_grant', '승인 코드가 맞지 않거나, 이미 썼거나, 만료됐어요');
    this.row = { ...this.row, used_at: now };
  }

  /** 승인할 때 적어 둔 대로 새 기기를 만든다 */
  connect(now: Date): Device {
    const draft = this.row.device_draft as Readonly<Record<string, string>>;
    return Device.connect(
      draft.spaceId ?? '',
      draft.userId ?? '',
      draft.name ?? '',
      this.row.client_id,
      draft.clientName ?? '',
      now,
    );
  }

  /** 승인: 코드와 state를 붙인 AI 도구의 주소 */
  view(consent: ConsentInput): ConsentResultView {
    return new ConsentResultView(AuthorizationPolicy.approvedRedirect(consent, this.code ?? ''));
  }
}
