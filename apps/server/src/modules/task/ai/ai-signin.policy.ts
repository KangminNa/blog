import { RuleViolation } from '../../platform';

// 웹 AI 로그인에서 러너가 알려 오는 값의 모양. 러너가 읽은 CLI 화면은 믿을 수 없는 입력이라
// 주인에게 보여 줄 주소와 저장할 자격은 정해진 모양일 때만 받는다 (Paperclip의 setup-token-parse ·
// device-login-parse가 실제 CLI 화면으로 확인한 값, MIT).
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 모양 규칙 한 곳. 러너의 알림과 저장이 함께 쓴다
export class AiSigninPolicy {
  /** claude setup-token의 로그인 주소 (출처 + 경로). CLI 버전에 따라 둘 중 하나 */
  private static readonly CLAUDE_URLS: readonly string[] = [
    'https://claude.ai/oauth/authorize',
    'https://claude.com/cai/oauth/authorize',
  ];
  /** codex login --device-auth의 로그인 주소. 쿼리 없이 정확히 이것 */
  private static readonly CODEX_URL = 'https://auth.openai.com/codex/device';
  /** Codex가 보여 주는 한 번 쓰는 코드 (네 글자-다섯 글자) */
  private static readonly CODEX_USER_CODE = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{5}$/;
  /** setup-token이 만든 1년 토큰 */
  private static readonly CLAUDE_TOKEN = /^sk-ant-oat01-[A-Za-z0-9_-]{20,}$/;
  /** 사람이 브라우저에서 붙여 넣는 코드: 공백 없는 보이는 글자 */
  private static readonly BROWSER_CODE = /^[\x21-\x7E]{4,1024}$/;
  private static readonly AUTH_JSON_MAX = 64 * 1024;

  /** 주인에게 보여 줄 로그인 주소. 정해진 출처·경로만, 사용자 정보·포트·조각 없이 */
  static assertUrl(tool: string, url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new RuleViolation('로그인 주소의 모양이 아니에요');
    }
    const base = `${parsed.origin}${parsed.pathname}`;
    const plain = !parsed.username && !parsed.password && !parsed.port && !parsed.hash;
    const known =
      tool === 'claude'
        ? AiSigninPolicy.CLAUDE_URLS.includes(base)
        : base === AiSigninPolicy.CODEX_URL && !parsed.search;
    if (!plain || !known || /sk-ant-/i.test(url))
      throw new RuleViolation('알 수 없는 로그인 주소예요');
  }

  /** Codex는 화면의 코드가 꼭 있고, Claude는 없다 */
  static assertUserCode(tool: string, userCode: string | null): void {
    const ok =
      tool === 'codex'
        ? userCode !== null && AiSigninPolicy.CODEX_USER_CODE.test(userCode)
        : userCode === null;
    if (!ok) throw new RuleViolation('로그인 코드의 모양이 아니에요');
  }

  static assertBrowserCode(code: string): void {
    if (!AiSigninPolicy.BROWSER_CODE.test(code))
      throw new RuleViolation('공백 없이 브라우저에 나온 코드를 그대로 붙여 넣어 주세요');
  }

  /** 저장할 자격. Claude는 1년 토큰, Codex는 JSON 객체인 auth.json */
  static assertCredential(tool: string, credential: string): void {
    if (tool === 'claude') {
      if (!AiSigninPolicy.CLAUDE_TOKEN.test(credential))
        throw new RuleViolation('setup-token의 토큰 모양이 아니에요');
      return;
    }
    if (credential.length > AiSigninPolicy.AUTH_JSON_MAX)
      throw new RuleViolation('auth.json이 너무 커요');
    let parsed: unknown;
    try {
      parsed = JSON.parse(credential);
    } catch {
      throw new RuleViolation('auth.json의 모양이 아니에요');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new RuleViolation('auth.json의 모양이 아니에요');
  }
}
