import { homedir } from 'node:os';
import type { Shell } from './shell';
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
  /** 명령줄 이름 (예: claude) */
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
  /** 브라우저로 로그인 (블로그의 승인 화면). 끝나면 true */
  abstract login(): Promise<boolean>;

  /** 스킬 본문을 이 도구에 맞게 고친다: {{SKILL_DIR}}을 실제 폴더로, 도구 전용 머리말 */
  renderSkill(text: string, skillDir: string): string {
    return text.split('{{SKILL_DIR}}').join(skillDir);
  }

  /** 명령줄의 버전. 명령이 없으면 null */
  async version(): Promise<string | null> {
    const res = await this.shell.run(this.command, ['--version']);
    return res.ok ? res.stdout.trim().split('\n')[0] || this.command : null;
  }

  protected async must(args: readonly string[], failure: string): Promise<void> {
    const res = await this.shell.run(this.command, args);
    if (!res.ok) throw new CliError(`${failure}: ${res.output}`);
  }
}
