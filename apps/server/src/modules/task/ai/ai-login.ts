import {
  BaseEntity,
  RuleViolation,
  SealedSecret,
  type SecretBox,
  TableEntity,
} from '../../platform';
import type { AiLoginNew, AiLoginRow } from '../task.tables';
import { AiTokenView, AiToolView } from './ai-login.view';

// AI 도구의 로그인 하나. 콘솔에서 넣은 토큰을 서버 키로 잠가 두었다가 러너에게 건넨다.
// 푸는 곳은 tokenView() 하나뿐이고, 화면에는 만료와 연결 확인 결과만 보인다.
export class AiLogin extends TableEntity<AiLoginRow, AiLoginNew> {
  static readonly CLAUDE = 'claude';
  /** setup-token의 토큰은 1년 간다. CLI가 남은 기간을 알려 주지 않아 저장한 날부터 센다 */
  private static readonly TERM_YEARS = 1;

  static open(spaceId: string, tool: string, sealed: SealedSecret, now: Date): AiLogin {
    return new AiLogin(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        tool,
        secret: sealed.ciphertext,
        nonce: sealed.nonce,
        expires_at: AiLogin.endOfTerm(now),
        created_at: now,
      },
      true,
    );
  }

  static restore(row: AiLoginRow): AiLogin {
    return new AiLogin(row);
  }

  private static endOfTerm(now: Date): Date {
    const end = new Date(now);
    end.setUTCFullYear(end.getUTCFullYear() + AiLogin.TERM_YEARS);
    return end;
  }

  get tool(): string {
    return this.row.tool;
  }

  /** 새 토큰으로 바꾼다. 앞 토큰의 만료와 확인 결과는 새 토큰의 것이 아니다 */
  replace(sealed: SealedSecret, now: Date): void {
    this.seal(sealed);
    this.put('expires_at', AiLogin.endOfTerm(now));
    this.put('checked_at', null);
    this.put('last_error', null);
  }

  /** 연결 확인의 결과. error가 null이면 성공 */
  noteTest(error: string | null, now: Date): void {
    this.put('checked_at', now);
    this.put('last_error', error);
  }

  /** 지금 서버 키로 다시 잠근다. 이미 지금 키면 false */
  reseal(box: SecretBox): boolean {
    const resealed = box.reseal(this.sealed);
    if (resealed === null) return false;
    this.seal(resealed);
    return true;
  }

  assertUsable(now: Date): void {
    if (!this.usableAt(now))
      throw new RuleViolation('만료된 토큰이에요. 콘솔의 AI 메뉴에서 새로 넣어 주세요');
  }

  /** 콘솔이 보는 도구 하나 */
  view(now: Date): AiToolView {
    return new AiToolView(this.row.tool, this.usableAt(now), this.row);
  }

  /** 토큰을 풀어 러너에게 건넨다. 만료됐으면 건네지 않는다 */
  tokenView(now: Date, box: SecretBox): AiTokenView {
    this.assertUsable(now);
    return new AiTokenView(box.open(this.sealed), this.row);
  }

  private get sealed(): SealedSecret {
    return new SealedSecret(this.row.secret, this.row.nonce);
  }

  /** 지금 쓸 수 있는가. 저장한 날부터 세므로 실제 토큰이 이보다 오래 가지는 않는다 */
  private usableAt(now: Date): boolean {
    return this.row.expires_at.getTime() > now.getTime();
  }

  private seal(sealed: SealedSecret): void {
    this.put('secret', sealed.ciphertext);
    this.put('nonce', sealed.nonce);
  }
}
