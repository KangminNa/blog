// 로그인 명령(claude setup-token · codex login --device-auth)이 터미널에 그린 화면을 읽는다.
// 화면은 비밀이다: 주소, 붙여 넣은 코드의 메아리, 토큰이 섞여 있다. 그래서 통째로 어디에도 보내거나 적지 않고,
// 정해진 모양의 값만 꺼낸다. 서버도 같은 모양을 한 번 더 본다 (AiSigninPolicy).
// 읽는 규칙은 Paperclip이 실제 CLI 화면으로 확인한 것을 따른다 (setup-token-parse · device-login-parse, MIT).
export class SigninScreen {
  /**
   * 터미널 제어 문자열. 글자 모양(색)은 지우고, 같은 줄 안의 이동(C 앞으로, G 칸 번호로)은 Ink가 낱말 사이에 쓰므로 빈칸으로,
   * 그 밖의 커서 이동은 줄바꿈으로 바꿔 다시 그린 화면이 붙지 않게 한다 (claude 2.1.318의 실제 화면으로 확인)
   */
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly CSI = /\x1b\[[0-?]*[ -/]*([@-~])/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly ESC = /\x1b[@-Z\\-_]/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 제어 문자열을 지우려는 식이다
  private static readonly CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

  private static readonly CSI_AS: Readonly<Record<string, string>> = { m: '', C: ' ', G: ' ' };

  private static readonly CLAUDE_URL =
    /https:\/\/(?:claude\.ai\/oauth\/authorize|claude\.com\/cai\/oauth\/authorize)\?[A-Za-z0-9\-._~:/?@!$&'()*+,;=%]+(?=\s)/;
  private static readonly CLAUDE_TOKEN = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/g;
  private static readonly TOKEN_START = 'Your OAuth token';
  private static readonly TOKEN_END = 'Store this token';

  private static readonly CODEX_URL = /https:\/\/auth\.openai\.com\/codex\/device(?=\s)/;
  private static readonly CODEX_MARK = /one-time code/i;
  private static readonly CODEX_CODE = /(?:^|\s)([A-Za-z0-9]{4}-[A-Za-z0-9]{5})(?=\s)/;
  /** 화면은 이만큼만 둔다. 로그인 화면은 몇 KB라 넘치면 이상한 출력이다 */
  private static readonly MAX = 256 * 1024;

  private raw = '';

  constructor(readonly tool: string) {}

  add(chunk: string): void {
    this.raw = (this.raw + chunk).slice(-SigninScreen.MAX);
  }

  /** 제어 문자열을 뺀 글. 줄은 \n으로만 나눈다 */
  get text(): string {
    return this.raw
      .replace(SigninScreen.OSC, '')
      .replace(SigninScreen.CSI, (_all, final: string) => SigninScreen.CSI_AS[final] ?? '\n')
      .replace(SigninScreen.ESC, '\n')
      .replace(/\r\n?/g, '\n')
      .replace(SigninScreen.CONTROL, '');
  }

  /** 주인에게 보일 로그인 주소. 끝까지 그려진 것만 (뒤에 글자가 더 와야 다 온 것이다) */
  get url(): string | null {
    const text = this.text;
    if (this.tool === 'codex') {
      const found = SigninScreen.CODEX_URL.exec(text);
      return found && this.userCodeIn(text) ? found[0] : null;
    }
    return SigninScreen.CLAUDE_URL.exec(text)?.[0] ?? null;
  }

  /** Codex가 보이는 한 번 쓰는 코드 ("one-time code" 다음에 오는 XXXX-XXXXX). Claude는 없다 */
  get userCode(): string | null {
    return this.tool === 'codex' ? this.userCodeIn(this.text) : null;
  }

  /**
   * setup-token이 그린 1년 토큰. "Your OAuth token"과 "Store this token" 사이의 마지막 것.
   * 끝 표시가 아직 없으면 토큰이 다 오지 않았을 수 있어, 명령이 잘 끝났을 때(ended)만 앞 표시 뒤에서 찾는다.
   * 표시 문구가 CLI 버전에 따라 바뀌어도 토큰은 한 번만 보이므로, 잘 끝났으면 화면 전체의 마지막 토큰을 쓴다
   * (로그인 전 화면과 붙여 넣은 코드의 메아리에는 이 모양이 없다)
   */
  claudeToken(ended: boolean): string | null {
    const text = this.text;
    const start = text.lastIndexOf(SigninScreen.TOKEN_START);
    if (start < 0) return ended ? (text.match(SigninScreen.CLAUDE_TOKEN)?.at(-1) ?? null) : null;
    const end = text.indexOf(SigninScreen.TOKEN_END, start);
    if (end < 0 && !ended) return null;
    const between = text.slice(start, end < 0 ? undefined : end);
    return between.match(SigninScreen.CLAUDE_TOKEN)?.at(-1) ?? null;
  }

  private userCodeIn(text: string): string | null {
    const mark = SigninScreen.CODEX_MARK.exec(text);
    if (!mark) return null;
    return SigninScreen.CODEX_CODE.exec(text.slice(mark.index + mark[0].length))?.[1] ?? null;
  }
}
