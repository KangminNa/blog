import { RuleViolation, type SealedSecret, type SecretBox, TrackedEntity } from '../../platform';

// AI 도구의 로그인 하나. 콘솔에서 넣은 토큰을 서버 키로 잠가 두었다가 러너에게 건넨다.
// 푸는 곳은 tokenAt() 하나뿐이고, 화면에는 만료와 연결 확인 결과만 보인다.
export class AiLogin extends TrackedEntity {
  static readonly CLAUDE = 'claude';
  /** setup-token의 토큰은 1년 간다. CLI가 남은 기간을 알려 주지 않아 저장한 날부터 센다 */
  private static readonly TERM_YEARS = 1;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly tool: string,
    private sealedValue: SealedSecret,
    private expires: Date,
    private checked: Date | null,
    private error: string | null,
    readonly createdAt: Date,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  static open(spaceId: string, tool: string, sealed: SealedSecret, now: Date): AiLogin {
    return new AiLogin(
      AiLogin.newId(),
      1,
      spaceId,
      tool,
      sealed,
      AiLogin.endOfTerm(now),
      null,
      null,
      now,
      true,
    );
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    tool: string,
    sealed: SealedSecret,
    expiresAt: Date,
    checkedAt: Date | null,
    lastError: string | null,
    createdAt: Date,
  ): AiLogin {
    return new AiLogin(
      id,
      version,
      spaceId,
      tool,
      sealed,
      expiresAt,
      checkedAt,
      lastError,
      createdAt,
      false,
    );
  }

  private static endOfTerm(now: Date): Date {
    const end = new Date(now);
    end.setUTCFullYear(end.getUTCFullYear() + AiLogin.TERM_YEARS);
    return end;
  }

  get sealed(): SealedSecret {
    return this.sealedValue;
  }

  get expiresAt(): Date {
    return this.expires;
  }

  get checkedAt(): Date | null {
    return this.checked;
  }

  get lastError(): string | null {
    return this.error;
  }

  /** 지금 쓸 수 있는가. 저장한 날부터 세므로 실제 토큰이 이보다 오래 가지는 않는다 */
  usableAt(now: Date): boolean {
    return this.expires.getTime() > now.getTime();
  }

  /** 새 토큰으로 바꾼다. 앞 토큰의 만료와 확인 결과는 새 토큰의 것이 아니다 */
  replace(sealed: SealedSecret, now: Date): void {
    this.seal(sealed);
    this.expires = AiLogin.endOfTerm(now);
    this.track('expires_at', this.expires);
    this.checked = null;
    this.track('checked_at', null);
    this.error = null;
    this.track('last_error', null);
  }

  /** 연결 확인의 결과. error가 null이면 성공 */
  noteTest(error: string | null, now: Date): void {
    this.checked = now;
    this.track('checked_at', now);
    this.error = error;
    this.track('last_error', error);
  }

  /** 지금 서버 키로 다시 잠근다. 이미 지금 키면 false */
  reseal(box: SecretBox): boolean {
    const resealed = box.reseal(this.sealedValue);
    if (resealed === null) return false;
    this.seal(resealed);
    return true;
  }

  assertUsable(now: Date): void {
    if (!this.usableAt(now))
      throw new RuleViolation('만료된 토큰이에요. 콘솔의 AI 메뉴에서 새로 넣어 주세요');
  }

  /** 토큰을 푼다. 만료됐으면 건네지 않는다 */
  tokenAt(now: Date, box: SecretBox): string {
    this.assertUsable(now);
    return box.open(this.sealedValue);
  }

  private seal(sealed: SealedSecret): void {
    this.sealedValue = sealed;
    this.track('secret', sealed.ciphertext);
    this.track('nonce', sealed.nonce);
  }
}
