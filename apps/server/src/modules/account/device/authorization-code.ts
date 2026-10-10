import { createHash, randomBytes } from 'node:crypto';
import { BaseEntity } from '../../platform';
import { OAuthError } from './oauth-error';

// 주인이 승인 화면에서 "연결"을 누르면 나가는 일회용 코드. 5분 안에, 한 번만, 같은 클라이언트·같은 주소·
// 맞는 PKCE 확인값(code_verifier)으로만 토큰으로 바꿀 수 있다. 기기는 코드를 바꿀 때 만든다 (그만둔 승인은 기기를 남기지 않음).
export class AuthorizationCode extends BaseEntity {
  static readonly TTL_MS = 5 * 60_000;

  private constructor(
    readonly codeHash: string,
    readonly clientId: string,
    readonly redirectUri: string,
    readonly codeChallenge: string,
    readonly spaceId: string,
    readonly userId: string,
    readonly deviceName: string,
    readonly clientName: string,
    readonly expiresAt: Date,
    private usedAt: Date | null,
    /** 만든 순간에만 있는 원문 (주인이 승인한 뒤 AI 도구에게 한 번 돌려준다) */
    readonly code: string | null,
  ) {
    super(codeHash, 1);
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
  ): AuthorizationCode {
    const code = randomBytes(32).toString('base64url');
    return new AuthorizationCode(
      AuthorizationCode.hash(code),
      clientId,
      redirectUri,
      codeChallenge,
      spaceId,
      userId,
      deviceName,
      clientName,
      new Date(now.getTime() + AuthorizationCode.TTL_MS),
      null,
      code,
    );
  }

  static restore(
    codeHash: string,
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    spaceId: string,
    userId: string,
    deviceName: string,
    clientName: string,
    expiresAt: Date,
    usedAt: Date | null,
  ): AuthorizationCode {
    return new AuthorizationCode(
      codeHash,
      clientId,
      redirectUri,
      codeChallenge,
      spaceId,
      userId,
      deviceName,
      clientName,
      expiresAt,
      usedAt,
      null,
    );
  }

  static hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  get used(): Date | null {
    return this.usedAt;
  }

  /** 토큰으로 바꾼다. 틀린 곳이 하나라도 있으면 invalid_grant (어디가 틀렸는지는 자세히 알리지 않음) */
  redeem(clientId: string, redirectUri: string, verifier: string, now: Date): void {
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const ok =
      this.usedAt === null &&
      now.getTime() < this.expiresAt.getTime() &&
      clientId === this.clientId &&
      redirectUri === this.redirectUri &&
      challenge === this.codeChallenge;
    if (!ok)
      throw new OAuthError('invalid_grant', '승인 코드가 맞지 않거나, 이미 썼거나, 만료됐어요');
    this.usedAt = now;
  }
}
