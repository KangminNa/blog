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
    const res = await this.shell.run(this.command, ['mcp', 'get', AiTool.SERVER]);
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

  async login(): Promise<boolean> {
    return (await this.shell.interact(this.command, ['mcp', 'login', AiTool.SERVER])) === 0;
  }
}
