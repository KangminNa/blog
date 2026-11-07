import {
  BaseEntity,
  RuleViolation,
  SealedSecret,
  type SecretBox,
  TableEntity,
} from '../../platform';
import type { AiLoginNew, AiLoginRow } from '../task.tables';
import { AiLoginVersionView, AiTokenView, AiToolView } from './ai-login.view';

// AI 도구의 로그인 하나. 콘솔에서 넣거나 웹 로그인으로 받은 자격을 서버 키로 잠가 두었다가 러너에게 건넨다.
// 푸는 곳은 tokenView() 하나뿐이고, 화면에는 만료와 연결 확인 결과만 보인다.
//   Claude: setup-token의 토큰 한 줄. 저장한 날부터 1년
//   Codex: codex login이 만든 auth.json 내용 (갱신 토큰이 들어 있어 만료를 알 수 없다, expires_at null)
export class AiLogin extends TableEntity<AiLoginRow, AiLoginNew> {
  static readonly CLAUDE = 'claude';
  static readonly CODEX = 'codex';
  /**
   * 쓸 때마다 갱신 토큰이 바뀌는 자격의 도구. 러너가 실행 뒤 바뀐 자격을 되돌려 쓰고(ai_login_refresh),
   * 서버는 이 도구의 일을 한 번에 하나만 빌려 준다 (LeasePolicy)
   */
  static readonly ROTATING: readonly string[] = [AiLogin.CODEX];
  /** 로그인을 받는 도구 (task.ai_logins의 CHECK와 같다) */
  static readonly TOOLS: readonly string[] = [AiLogin.CLAUDE, AiLogin.CODEX];
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
        expires_at: AiLogin.termOf(tool, now),
        created_at: now,
      },
      true,
    );
  }

  static restore(row: AiLoginRow): AiLogin {
    return new AiLogin(row);
  }

  /** 실행 뒤 바뀐 자격을 되돌려 쓰는 도구인가. 아니면 RuleViolation */
  static assertRotating(tool: string): void {
    if (!AiLogin.ROTATING.includes(tool))
      throw new RuleViolation(`${tool}의 자격은 실행해도 바뀌지 않아요`);
  }

  /** 도구가 로그인을 받는가. 아니면 RuleViolation */
  static assertTool(tool: string): void {
    if (!AiLogin.TOOLS.includes(tool))
      throw new RuleViolation(`로그인할 수 있는 도구는 ${AiLogin.TOOLS.join(' · ')}예요`);
  }

  /** Claude는 저장한 날부터 1년. Codex는 CLI가 스스로 갱신해 만료를 알 수 없다 */
  private static termOf(tool: string, now: Date): Date | null {
    if (tool !== AiLogin.CLAUDE) return null;
    const end = new Date(now);
    end.setUTCFullYear(end.getUTCFullYear() + AiLogin.TERM_YEARS);
    return end;
  }

  get tool(): string {
    return this.row.tool;
  }

  /**
   * 같은 로그인의 갱신된 자격으로 바꾼다 (CLI가 실행 중에 토큰을 갱신했다). 로그인은 그대로라
   * 만료와 연결 확인 결과는 둔다. 판은 저장할 때 오른다: 늦게 온 옛 자격은 판이 맞지 않아 덮지 못한다
   */
  refresh(sealed: SealedSecret): void {
    this.seal(sealed);
  }

  /** 새 토큰으로 바꾼다. 앞 토큰의 만료와 확인 결과는 새 토큰의 것이 아니다 */
  replace(sealed: SealedSecret, now: Date): void {
    this.seal(sealed);
    this.put('expires_at', AiLogin.termOf(this.row.tool, now));
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

  /** 콘솔이 보는 도구 하나. 토큰은 다시 보내지 않는다 */
  view(now: Date): AiToolView {
    return new AiToolView(this.row.tool, this.row, this.usableAt(now));
  }

  /** 토큰을 풀어 러너에게 건넨다. 만료됐으면 건네지 않는다 */
  tokenView(now: Date, box: SecretBox): AiTokenView {
    this.assertUsable(now);
    return new AiTokenView(box.open(this.sealed), this.row);
  }

  /** 저장한 뒤의 판 */
  versionView(): AiLoginVersionView {
    return new AiLoginVersionView(this.row);
  }

  private get sealed(): SealedSecret {
    return new SealedSecret(this.row.secret, this.row.nonce);
  }

  /** 지금 쓸 수 있는가. 저장한 날부터 세므로 실제 토큰이 이보다 오래 가지는 않는다 */
  private usableAt(now: Date): boolean {
    const expires = this.row.expires_at;
    return expires === null || expires.getTime() > now.getTime();
  }

  private seal(sealed: SealedSecret): void {
    this.put('secret', sealed.ciphertext);
    this.put('nonce', sealed.nonce);
  }
}
