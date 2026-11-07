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
// 설치는 시작할 때 한 번 본다. CLI를 새로 깔면 러너를 다시 켠다.
export class RunnerAbility {
  constructor(
    readonly tools: readonly string[],
    readonly signinTools: readonly string[],
    readonly ownLogins: readonly string[],
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
    );
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
    return `일할 수 있는 AI: ${list(this.tools)} · 웹 로그인: ${list(this.signinTools)}${own}`;
  }

  /** next_jobs에 싣는 값 */
  toArgs(): { tools: string[]; signin_tools: string[]; own_logins: string[] } {
    return {
      tools: [...this.tools],
      signin_tools: [...this.signinTools],
      own_logins: [...this.ownLogins],
    };
  }
}
