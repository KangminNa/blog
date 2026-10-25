import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AiTool, McpServerState } from './ai-tool';

// Claude Code: 스킬은 ~/.claude/skills, 검토자는 ~/.claude/agents, MCP는 `claude mcp`.
export class ClaudeCode extends AiTool {
  readonly id = 'claude-code';
  readonly label = 'Claude Code';
  readonly command = 'claude';
  readonly install = 'npm install -g @anthropic-ai/claude-code';
  readonly agentKind = 'claude';
  readonly confirmsConnection = true;

  /** ~/.claude (CLAUDE_CONFIG_DIR이 있으면 그것) */
  private get configDir(): string {
    return this.env.CLAUDE_CONFIG_DIR || join(this.home, '.claude');
  }

  get skillsDir(): string {
    return join(this.configDir, 'skills');
  }

  get agentsDir(): string {
    return join(this.configDir, 'agents');
  }

  /** 저장할 때 묻지 않을 것: cairn 도구 두 개와 이 스킬의 스크립트 */
  override renderSkill(text: string, skillDir: string): string {
    const allowed = `allowed-tools: mcp__${AiTool.SERVER}__check_session, mcp__${AiTool.SERVER}__save_session, Bash(node \${CLAUDE_SKILL_DIR}/scripts/*)`;
    return super
      .renderSkill(text, skillDir)
      .replace(/^(---\n[\s\S]*?)\n---\n/, `$1\n${allowed}\n---\n`);
  }

  async server(): Promise<McpServerState | null> {
    const res = await this.run(['mcp', 'get', AiTool.SERVER]);
    if (!res.ok || /no mcp server found/i.test(res.output)) return null;
    const line = (name: string) =>
      res.output
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().startsWith(`${name}:`))
        ?.slice(name.length + 1)
        .trim() ?? null;
    return new McpServerState(line('url'), line('status') ?? res.output);
  }

  async addServer(url: string): Promise<void> {
    await this.must(
      ['mcp', 'add', '--transport', 'http', '--scope', 'user', AiTool.SERVER, url],
      'MCP 서버를 등록하지 못했어요',
    );
  }

  async removeServer(): Promise<void> {
    await this.must(
      ['mcp', 'remove', AiTool.SERVER, '--scope', 'user'],
      '등록된 MCP 서버를 지우지 못했어요',
    );
  }

  /**
   * PATH에 claude가 없을 때: 설치 프로그램이 넣는 자리, 그다음 Claude 데스크톱 앱(macOS)에 든 것을 새 버전부터.
   * 데스크톱 앱만 깔린 컴퓨터는 claude가 PATH에 없다. 앱의 폴더 모양은 공개된 약속이 아니라 못 찾으면 설치를 안내한다
   */
  protected override fallbacks(): string[] {
    return [
      join(this.home, '.local', 'bin', 'claude'),
      join(this.home, '.claude', 'local', 'claude'),
      ...ClaudeCode.desktopApp(
        join(this.home, 'Library', 'Application Support', 'Claude', 'claude-code'),
      ),
    ];
  }

  /** <폴더>/<버전>/<해시>/claude.app/Contents/MacOS/claude, 새 버전부터 */
  private static desktopApp(root: string): string[] {
    const dirs = (dir: string) => {
      try {
        return readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        return [];
      }
    };
    const newer = (a: string, b: string) => {
      const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
      for (let i = 0; i < Math.max(x.length, y.length); i++)
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
      return 0;
    };
    return dirs(root)
      .filter((v) => /^\d+(\.\d+)*$/.test(v))
      .sort(newer)
      .flatMap((v) =>
        dirs(join(root, v)).map((h) =>
          join(root, v, h, 'claude.app', 'Contents', 'MacOS', 'claude'),
        ),
      );
  }
}
