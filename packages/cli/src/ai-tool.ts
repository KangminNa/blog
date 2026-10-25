import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { type Shell, ShellResult } from './shell';
import { CliError } from './terminal';

/** AI 도구에 등록된 cairn MCP 서버 하나 (도구의 `mcp get`·`mcp list`를 읽은 것) */
export class McpServerState {
  constructor(
    readonly url: string | null,
    /** 도구가 보여 준 상태 글 (예: "✓ Connected", "! Needs authentication") */
    readonly status: string,
  ) {}

  get connected(): boolean {
    return /\bconnected\b/i.test(this.status) && !/fail|not connected|need/i.test(this.status);
  }
}

// 이 컴퓨터에서 도는 AI 도구 하나 (Claude Code, Codex …): 스킬·검토자를 넣을 자리, MCP 등록·로그인 명령.
// 로그인과 토큰 보관·갱신은 그 도구가 한다. 새 도구는 이것을 상속한 클래스 하나를 더한다.
export abstract class AiTool {
  /** MCP 서버 이름. 스킬이 부르는 도구 이름(예: mcp__cairn__save_session)과 맞아야 한다 */
  static readonly SERVER = 'cairn';

  /** --tool 값이자 노트의 tool 값 (예: claude-code) */
  abstract readonly id: string;
  /** 사람에게 보이는 이름 */
  abstract readonly label: string;
  /** 명령줄 이름 (예: claude). PATH에 없으면 fallbacks()에서 찾는다 */
  abstract readonly command: string;
  /** 명령줄이 없을 때 알려 줄 설치 방법 */
  abstract readonly install: string;
  /** 검토자 정의 폴더 이름 (skills/<스킬>/agents/<이것>) */
  abstract readonly agentKind: string;
  /** 사용자 스킬 폴더 */
  abstract readonly skillsDir: string;
  /** 사용자 하위 에이전트(검토자) 폴더 */
  abstract readonly agentsDir: string;
  /** 연결 상태를 명령으로 확인할 수 있는가. 못 하면 마지막에 도구 안에서 확인하라고 안내한다 */
  abstract readonly confirmsConnection: boolean;

  /** 로그인 명령의 인자 (브라우저로 블로그 승인 화면을 연다) */
  protected readonly loginArgs: readonly string[] = ['mcp', 'login', AiTool.SERVER];
  /** 찾은 실행 파일과 그 버전 (처음 쓸 때 찾는다. 못 찾으면 null) */
  private bin: string | null | undefined;
  private versionText: string | null = null;

  constructor(
    protected readonly shell: Shell,
    protected readonly env: Readonly<Record<string, string | undefined>> = process.env,
    protected readonly home: string = homedir(),
  ) {}

  /** 등록된 cairn 서버. 없으면 null */
  abstract server(): Promise<McpServerState | null>;
  /** 모든 프로젝트에서 쓰도록 등록한다 */
  abstract addServer(url: string): Promise<void>;
  abstract removeServer(): Promise<void>;

  /** 스킬 본문을 이 도구에 맞게 고친다: {{SKILL_DIR}}을 실제 폴더로, 도구 전용 머리말 */
  renderSkill(text: string, skillDir: string): string {
    return text.split('{{SKILL_DIR}}').join(skillDir);
  }

  /** PATH에 명령이 없을 때 찾아볼 실행 파일 (예: 데스크톱 앱에 든 것). 앞의 것부터 */
  protected fallbacks(): string[] {
    return [];
  }

  /** 부를 실행 파일: PATH의 명령, 없으면 fallbacks() 중 실제로 도는 첫 번째. 못 찾으면 null */
  async executable(): Promise<string | null> {
    if (this.bin !== undefined) return this.bin;
    this.bin = null;
    for (const candidate of [this.command, ...this.fallbacks().filter((p) => existsSync(p))]) {
      const res = await this.shell.run(candidate, ['--version']);
      if (!res.ok) continue;
      this.bin = candidate;
      this.versionText = res.stdout.trim().split('\n')[0] || this.command;
      break;
    }
    return this.bin;
  }

  /** 명령줄의 버전. 명령이 없으면 null */
  async version(): Promise<string | null> {
    return (await this.executable()) ? this.versionText : null;
  }

  /** 브라우저로 로그인 (블로그의 승인 화면). 사람이 입력할 수 있는 터미널에서만 된다. 끝나면 true */
  async login(): Promise<boolean> {
    const bin = await this.executable();
    return bin !== null && (await this.shell.interact(bin, this.loginArgs)) === 0;
  }

  /** 사람이 터미널에 그대로 붙여 넣을 로그인 명령 (경로에 빈칸이 있으면 따옴표) */
  async loginCommand(): Promise<string> {
    const bin = (await this.executable()) ?? this.command;
    return [/\s/.test(bin) ? `"${bin}"` : bin, ...this.loginArgs].join(' ');
  }

  protected async run(args: readonly string[]): Promise<ShellResult> {
    const bin = await this.executable();
    return bin
      ? this.shell.run(bin, args)
      : new ShellResult(127, '', `${this.command}을 찾을 수 없어요`);
  }

  protected async must(args: readonly string[], failure: string): Promise<void> {
    const res = await this.run(args);
    if (!res.ok) throw new CliError(`${failure}: ${res.output}`);
  }
}
