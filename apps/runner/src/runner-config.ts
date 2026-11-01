import { resolve } from 'node:path';

/** 설정이 빠졌거나 틀림. 시작하지 않고 이 문구만 보여 준다 */
export class ConfigProblem extends Error {}

// 러너 설정 (환경 변수). 토큰 값은 오류 문구에 넣지 않는다.
export class RunnerConfig {
  private static readonly DEFAULT_CLI = 'claude';
  /** apps/runner/src 기준 저장소의 skills/ */
  private static readonly DEFAULT_SKILLS = resolve(__dirname, '../../../skills');

  constructor(
    /** 끝 슬래시 없는 블로그 주소 */
    readonly serverUrl: string,
    /** run 권한을 준 기기의 토큰. AI CLI에게 주지 않는다 */
    readonly deviceToken: string,
    /** 이 컴퓨터의 AI CLI 로그인. 없으면 콘솔에 넣은 토큰을 일마다 서버에서 받는다 */
    readonly claudeToken: string | null,
    readonly cliPath: string,
    readonly skillsDir: string,
  ) {}

  static fromEnv(env: Readonly<Record<string, string | undefined>>): RunnerConfig {
    const required = ['CAIRN_RUNNER_URL', 'CAIRN_RUNNER_TOKEN'];
    const missing = required.filter((name) => !env[name]?.trim());
    if (missing.length > 0)
      throw new ConfigProblem(`러너 설정이 빠졌어요: ${missing.join(', ')} (.env.example 참고)`);
    return new RunnerConfig(
      RunnerConfig.address(env.CAIRN_RUNNER_URL ?? ''),
      (env.CAIRN_RUNNER_TOKEN ?? '').trim(),
      env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || null,
      env.CAIRN_RUNNER_CLI?.trim() || RunnerConfig.DEFAULT_CLI,
      env.CAIRN_SKILLS_DIR?.trim() || RunnerConfig.DEFAULT_SKILLS,
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
