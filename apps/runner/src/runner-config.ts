import { resolve } from 'node:path';

/** 설정이 빠졌거나 틀림. 시작하지 않고 이 문구만 보여 준다 */
export class ConfigProblem extends Error {}

// 러너 설정 (환경 변수). 토큰 값은 오류 문구에 넣지 않는다.
export class RunnerConfig {
  private static readonly DEFAULT_CLI = 'claude';
  private static readonly DEFAULT_CODEX_CLI = 'codex';
  /** apps/runner/src 기준 저장소의 skills/ */
  private static readonly DEFAULT_SKILLS = resolve(__dirname, '../../../skills');
  private static readonly SLOT = /^[1-9][0-9]?$/;

  constructor(
    /** 끝 슬래시 없는 블로그 주소 */
    readonly serverUrl: string,
    /** run 권한을 준 기기의 토큰. AI CLI에게 주지 않는다. 서버 러너는 비워 두고 연결 값으로 받는다 */
    readonly deviceToken: string | null,
    /** 이 컴퓨터의 AI CLI 로그인. 없으면 콘솔에 넣은 토큰을 일마다 서버에서 받는다 */
    readonly claudeToken: string | null,
    readonly cliPath: string,
    readonly skillsDir: string,
    /**
     * 서버 러너의 연결 값 파일 (서버와 러너만 보는 볼륨). 기기 토큰이 없으면 이 값을 내밀고 토큰을 받는다.
     * 토큰이 있으면 쓰지 않는다
     */
    readonly pairingFile: string | null = null,
    /** Codex CLI. 지금은 웹 로그인(codex login --device-auth)에만 쓴다 */
    readonly codexCliPath: string = RunnerConfig.DEFAULT_CODEX_CLI,
    /** 로그인된 브라우저의 CDP 주소 (browser-tabs 패키지). 없으면 브라우저 탭을 읽지 않는다 */
    readonly browserUrl: string | null = null,
    /**
     * 코드 러너 칸의 번호 (docs/코드작업.md). 있으면 칸 기기로 연결해 코드 작업만 받는다.
     * 코드 러너 이미지(CAIRN_SANDBOX=1)에서 연결 값 파일로만 쓴다
     */
    readonly slot: string | null = null,
  ) {}

  static fromEnv(env: Readonly<Record<string, string | undefined>>): RunnerConfig {
    const token = env.CAIRN_RUNNER_TOKEN?.trim() || null;
    const pairingFile = env.CAIRN_RUNNER_PAIRING_FILE?.trim() || null;
    const missing = [
      ...(env.CAIRN_RUNNER_URL?.trim() ? [] : ['CAIRN_RUNNER_URL']),
      ...(token || pairingFile ? [] : ['CAIRN_RUNNER_TOKEN']),
    ];
    if (missing.length > 0)
      throw new ConfigProblem(`러너 설정이 빠졌어요: ${missing.join(', ')} (.env.example 참고)`);
    const slot = RunnerConfig.slotOf(env, token);
    return new RunnerConfig(
      RunnerConfig.address(env.CAIRN_RUNNER_URL ?? ''),
      token,
      env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || null,
      env.CAIRN_RUNNER_CLI?.trim() || RunnerConfig.DEFAULT_CLI,
      env.CAIRN_SKILLS_DIR?.trim() || RunnerConfig.DEFAULT_SKILLS,
      token ? null : pairingFile,
      env.CAIRN_RUNNER_CODEX_CLI?.trim() || RunnerConfig.DEFAULT_CODEX_CLI,
      env.CAIRN_BROWSER_URL?.trim() ? RunnerConfig.browser(env.CAIRN_BROWSER_URL) : null,
      slot,
    );
  }

  /** 받은 기기 토큰으로 일하는 설정 (서버 러너가 연결 값으로 토큰을 받은 뒤) */
  withToken(token: string): RunnerConfig {
    return new RunnerConfig(
      this.serverUrl,
      token,
      this.claudeToken,
      this.cliPath,
      this.skillsDir,
      this.pairingFile,
      this.codexCliPath,
      this.browserUrl,
      this.slot,
    );
  }

  get mcpUrl(): string {
    return `${this.serverUrl}/mcp`;
  }

  /**
   * 칸 번호 (CAIRN_RUNNER_SLOT). 칸은 셸이 있는 일을 받으므로 코드 러너 이미지에서만, 연결 값으로만 붙는다:
   * 내 컴퓨터에서 칸 번호를 잘못 넣어도 시작하지 않는다 (서버도 칸 기기에만 코드 작업을 준다)
   */
  private static slotOf(
    env: Readonly<Record<string, string | undefined>>,
    token: string | null,
  ): string | null {
    const slot = env.CAIRN_RUNNER_SLOT?.trim() || null;
    if (slot === null) return null;
    if (!RunnerConfig.SLOT.test(slot))
      throw new ConfigProblem(`CAIRN_RUNNER_SLOT은 1~99예요: ${slot}`);
    if (env.CAIRN_SANDBOX !== '1')
      throw new ConfigProblem('CAIRN_RUNNER_SLOT은 코드 러너 이미지(CAIRN_SANDBOX=1)에서만 써요');
    if (token !== null || !env.CAIRN_RUNNER_PAIRING_FILE?.trim())
      throw new ConfigProblem(
        '코드 러너 칸은 연결 값 파일(CAIRN_RUNNER_PAIRING_FILE)로만 붙어요. CAIRN_RUNNER_TOKEN은 비워 두세요',
      );
    return slot;
  }

  /** CDP 주소: 이 컴퓨터나 같은 망의 브라우저만 (http). 끝 슬래시는 뗀다 */
  private static browser(raw: string): string {
    const text = raw.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]/i.test(text) || !URL.canParse(text))
      throw new ConfigProblem(
        `CAIRN_BROWSER_URL은 브라우저의 CDP 주소여야 해요 (예: http://127.0.0.1:9222): ${text}`,
      );
    return text;
  }

  private static address(raw: string): string {
    const text = raw.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]/i.test(text) || !URL.canParse(text))
      throw new ConfigProblem(`CAIRN_RUNNER_URL은 http(s) 주소여야 해요: ${text}`);
    return text;
  }
}
