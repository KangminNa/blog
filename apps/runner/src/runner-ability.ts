import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { AiTools } from './ai-tool';
import { ClaudeCli } from './claude-cli';
import { CodexCli } from './codex-cli';
import type { RunnerConfig } from './runner-config';
import { SigninTerminal } from './signin-terminal';

// 이 러너가 할 수 있는 것. next_jobs로 서버에 알리면 서버가 할 수 있는 일만 빌려 준다
// (서버는 쓸 수 있는 로그인을 알아서, 러너가 미리 토큰을 묻고 빌렸다 돌려줄 필요가 없다).
//   tools        일할 수 있는 AI CLI: 설치돼 있고 이 러너가 그 도구로 일할 줄 안다
//   signinTools  웹 로그인을 대신 돌릴 수 있는 CLI: 설치돼 있고 PTY(script)를 만들 수 있다
//   ownLogins    러너가 스스로 가진 로그인 (환경 변수의 Claude 토큰)
//   browser      서버 브라우저에 붙어 있는가: 서버 러너(연결 값 파일)이고 CAIRN_BROWSER_URL이 있을 때만.
//                내 컴퓨터 러너의 브라우저는 탭 읽기에만 쓴다 (평소 쓰는 계정에 가까워 AI에게 맡기지 않는다)
//   runnerBuild  러너의 빌드 (이미지의 CAIRN_RUNNER_BUILD, 내 컴퓨터는 git 커밋): 어느 단락을 넣는지(Job.prompt)의 판이라 실행 기록에 남는다.
//                지시문의 글은 러너 스킬 cairn-runner의 틀이고 그 판은 서버가 따로 남긴다
//   cliVersions  도구마다 CLI 버전 (--version). 실행 기록에 남는다
//   slot         코드 러너 칸의 번호 (CAIRN_RUNNER_SLOT). 칸은 코드 작업만 받는다. next_jobs에는 싣지 않는다:
//                칸인지는 서버가 기기의 권한(sandbox)으로 정한다 (러너가 말한 값을 믿지 않게)
// 설치는 시작할 때 한 번 본다. CLI를 새로 깔면 러너를 다시 켠다.
export class RunnerAbility {
  private static readonly VERSION_MS = 5_000;
  /** 서버가 받는 길이 (NextJobsInput.BUILD_MAX) */
  private static readonly TEXT_MAX = 80;
  constructor(
    readonly tools: readonly string[],
    readonly signinTools: readonly string[],
    readonly ownLogins: readonly string[],
    readonly browser = false,
    readonly slot: string | null = null,
    readonly runnerBuild: string | null = null,
    readonly cliVersions: Readonly<Record<string, string>> = {},
  ) {}

  static detect(
    config: RunnerConfig,
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): RunnerAbility {
    const has = (bin: string) => RunnerAbility.installed(bin, env.PATH ?? '');
    const clis = [
      [ClaudeCli.TOOL, config.cliPath],
      [CodexCli.TOOL, config.codexCliPath],
    ]
      .filter(([, bin]) => has(bin as string))
      .map(([tool]) => tool as string);
    // 리눅스는 러너가 죽어도 로그인 명령이 남지 않게 timeout으로 감싼다 (SigninTerminal)
    const pty =
      SigninTerminal.supported && has('script') && (process.platform !== 'linux' || has('timeout'));
    return new RunnerAbility(
      clis.filter((tool) => AiTools.SUPPORTED.includes(tool)),
      pty ? clis : [],
      config.claudeToken === null ? [] : [ClaudeCli.TOOL],
      config.browserUrl !== null && config.pairingFile !== null && config.slot === null,
      config.slot,
      env.CAIRN_RUNNER_BUILD?.trim() || RunnerAbility.gitBuild() || 'unknown',
      Object.fromEntries(
        clis.flatMap((tool) => {
          const bin = tool === ClaudeCli.TOOL ? config.cliPath : config.codexCliPath;
          const version = RunnerAbility.versionOf(bin, env);
          return version === null ? [] : [[tool, version] as const];
        }),
      ),
    );
  }

  /** CLI의 버전 (--version의 첫 줄). 실행하지 못하면 null */
  static versionOf(bin: string, env: Readonly<Record<string, string | undefined>>): string | null {
    try {
      const out = execFileSync(bin, ['--version'], {
        env: { PATH: env.PATH ?? '', HOME: env.HOME ?? '' },
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: RunnerAbility.VERSION_MS,
      });
      return out.toString('utf8').trim().split('\n')[0]?.slice(0, RunnerAbility.TEXT_MAX) || null;
    } catch {
      return null;
    }
  }

  /** 저장소에서 도는 러너의 git 커밋. 저장소가 아니면 null */
  private static gitBuild(): string | null {
    try {
      return (
        execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
          cwd: __dirname,
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: RunnerAbility.VERSION_MS,
        })
          .toString('utf8')
          .trim() || null
      );
    } catch {
      return null;
    }
  }

  /** 코드 러너 칸인가 */
  get sandbox(): boolean {
    return this.slot !== null;
  }

  /** 실행할 수 있는 파일인가. 경로가 없으면 PATH에서 찾는다 */
  static installed(bin: string, path: string): boolean {
    const candidates = bin.includes('/')
      ? [bin]
      : path
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, bin));
    return candidates.some((file) => {
      try {
        accessSync(file, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  }

  /** 러너 로그의 한 줄 */
  get line(): string {
    const list = (tools: readonly string[]) => (tools.length > 0 ? tools.join(', ') : '없음');
    const own = this.ownLogins.length > 0 ? ` · 이 컴퓨터의 로그인: ${list(this.ownLogins)}` : '';
    const browser = this.browser ? ' · 브라우저 작업: 받음' : '';
    const code = this.sandbox ? ` · 코드 러너 칸 ${this.slot}: 코드 작업만 받음` : '';
    return `일할 수 있는 AI: ${list(this.tools)} · 웹 로그인: ${list(this.signinTools)}${own}${browser}${code}`;
  }

  /** next_jobs에 싣는 값 */
  toArgs(): {
    tools: string[];
    signin_tools: string[];
    own_logins: string[];
    browser: boolean;
    runner_build?: string;
    cli_versions?: Record<string, string>;
  } {
    return {
      tools: [...this.tools],
      signin_tools: [...this.signinTools],
      own_logins: [...this.ownLogins],
      browser: this.browser,
      ...(this.runnerBuild === null ? {} : { runner_build: this.runnerBuild }),
      ...(Object.keys(this.cliVersions).length === 0
        ? {}
        : { cli_versions: { ...this.cliVersions } }),
    };
  }
}
