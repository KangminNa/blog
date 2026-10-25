import { join } from 'node:path';
import { AiTool, McpServerState } from './ai-tool';

// Codex: 스킬은 ~/.agents/skills (Codex·Gemini CLI가 함께 읽는 자리), 검토자는 ~/.codex/agents/*.toml,
// MCP는 `codex mcp` (설정은 ~/.codex/config.toml의 [mcp_servers.cairn]). 문서: learn.chatgpt.com/docs/extend/mcp
// `codex mcp list`의 출력 모양은 공개된 약속이 아니라, 연결 확인은 Codex 안의 /mcp로 하라고 안내한다.
export class Codex extends AiTool {
  readonly id = 'codex';
  readonly label = 'Codex';
  readonly command = 'codex';
  readonly install = 'npm install -g @openai/codex';
  readonly agentKind = 'codex';
  readonly confirmsConnection = false;

  get skillsDir(): string {
    return join(this.home, '.agents', 'skills');
  }

  get agentsDir(): string {
    return join(this.env.CODEX_HOME || join(this.home, '.codex'), 'agents');
  }

  /** `codex mcp list`에서 cairn 줄을 찾는다: 이름으로 시작하고 주소가 있는 줄 */
  async server(): Promise<McpServerState | null> {
    const res = await this.run(['mcp', 'list']);
    if (!res.ok) return null;
    const line = res.output
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.split(/\s+/)[0] === AiTool.SERVER);
    if (!line) return null;
    return new McpServerState(/https?:\/\/\S+/.exec(line)?.[0] ?? null, line);
  }

  async addServer(url: string): Promise<void> {
    await this.must(['mcp', 'add', AiTool.SERVER, '--url', url], 'MCP 서버를 등록하지 못했어요');
  }

  async removeServer(): Promise<void> {
    await this.must(['mcp', 'remove', AiTool.SERVER], '등록된 MCP 서버를 지우지 못했어요');
  }
}
