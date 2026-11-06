import { resolve } from 'node:path';

/** 설정이 빠졌거나 틀림. 시작하지 않고 이 문구만 보여 준다 */
export class ConfigProblem extends Error {}

// 러너 설정 (환경 변수). 토큰 값은 오류 문구에 넣지 않는다.
export class RunnerConfig {
  private static readonly DEFAULT_CLI = 'claude';
  private static readonly DEFAULT_CODEX_CLI = 'codex';
  /** apps/runner/src 기준 저장소의 skills/ */
  private static readonly DEFAULT_SKILLS = resolve(__dirname, '../../../skills');

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
    return new RunnerConfig(
      RunnerConfig.address(env.CAIRN_RUNNER_URL ?? ''),
      token,
      env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || null,
      env.CAIRN_RUNNER_CLI?.trim() || RunnerConfig.DEFAULT_CLI,
      env.CAIRN_SKILLS_DIR?.trim() || RunnerConfig.DEFAULT_SKILLS,
      token ? null : pairingFile,
      env.CAIRN_RUNNER_CODEX_CLI?.trim() || RunnerConfig.DEFAULT_CODEX_CLI,
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
    );
  }

  get mcpUrl(): string {
    return `${this.serverUrl}/mcp`;
  }

  private static address(raw: string): string {
    const text = raw.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]/i.test(text) || !URL.canParse(text))
      throw new ConfigProblem(`CAIRN_RUNNER_URL은 http(s) 주소여야 해요: ${text}`);
    return text;
  }
}
