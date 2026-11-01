import { AiProcess } from './ai-process';
import { ClaudeStream } from './claude-stream';
import type { Job } from './job';
import type { JobWorkspace } from './job-workspace';

// Claude Code를 부르는 법. Codex가 들어올 때 공통 모양을 뽑는다 (객체설계 13장: 추상화는 둘째 구현이 생길 때).
//
// 격리: 설정·홈은 빈 임시 폴더, MCP는 --strict-mcp-config로 넘긴 cairn 하나, claude.ai 연결은 끈다.
// --bare는 쓰지 않는다: CLAUDE_CODE_OAUTH_TOKEN을 읽지 않는다.
// 권한: 셸을 주지 않는다. 내장 도구는 파일 도구만, 쓰기는 acceptEdits라 work 폴더 안에서만, MCP는 cairn만 묻지 않고 허락한다.
// -p는 물을 사람이 없어서 그 밖의 것은 거절된다. 주인의 컴퓨터에서 돌아가므로 AI가 지시문에 속아도 이 안에 머문다.
export class ClaudeCli {
  static readonly TOOL = 'claude';
  private static readonly FILE_TOOLS = ['Read', 'Write', 'Edit'];
  private static readonly SKILL_TOOL = 'Skill';
  /** 사용자 환경에서 넘기는 것. 나머지(기기 토큰 포함)는 AI CLI에게 가지 않는다 */
  private static readonly PASSED_ENV = [
    'PATH',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'TMPDIR',
    'SHELL',
    'USER',
  ];
  private static readonly HEADLESS_ENV: Readonly<Record<string, string>> = {
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };

  constructor(
    private readonly bin: string,
    private readonly oauthToken: string,
  ) {}

  /** mcp.json의 내용. 이 파일에만 작업 토큰을 쓴다 */
  static mcpConfig(url: string, runToken: string): string {
    return JSON.stringify({
      mcpServers: {
        [ClaudeStream.SERVER]: {
          type: 'http',
          url,
          headers: { Authorization: `Bearer ${runToken}` },
        },
      },
    });
  }

  args(workspace: JobWorkspace): readonly string[] {
    const tools = workspace.skillReady
      ? [...ClaudeCli.FILE_TOOLS, ClaudeCli.SKILL_TOOL]
      : ClaudeCli.FILE_TOOLS;
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--mcp-config',
      workspace.mcpConfigPath,
      '--tools',
      tools.join(','),
      '--allowedTools',
      `mcp__${ClaudeStream.SERVER}__*`,
      ...(workspace.skillReady ? [ClaudeCli.SKILL_TOOL] : []),
      '--permission-mode',
      'acceptEdits',
    ];
  }

  env(
    workspace: JobWorkspace,
    parent: Readonly<Record<string, string | undefined>>,
  ): Readonly<Record<string, string>> {
    const passed = ClaudeCli.PASSED_ENV.flatMap((name) => {
      const value = parent[name];
      return value === undefined ? [] : [[name, value] as const];
    });
    return {
      ...Object.fromEntries(passed),
      ...ClaudeCli.HEADLESS_ENV,
      HOME: workspace.homeDir,
      CLAUDE_CONFIG_DIR: workspace.configDir,
      CLAUDE_CODE_OAUTH_TOKEN: this.oauthToken,
    };
  }

  start(job: Job, workspace: JobWorkspace, onLine: (line: string) => void): AiProcess {
    return new AiProcess(
      this.bin,
      this.args(workspace),
      workspace.workDir,
      this.env(workspace, process.env),
      job.prompt(workspace.skillReady),
      onLine,
    );
  }
}
