import { AiProcess } from './ai-process';
import type { AiStream, AiTool } from './ai-tool';
import { BrowserMcp } from './browser-mcp';
import { ClaudeStream } from './claude-stream';
import type { CodeRoom } from './code-room';
import type { Job } from './job';
import { JobWorkspace } from './job-workspace';

// Claude Code를 부르는 법. Codex가 들어올 때 공통 모양을 뽑는다 (객체설계 13장: 추상화는 둘째 구현이 생길 때).
//
// 격리: 설정·홈은 빈 임시 폴더, MCP는 --strict-mcp-config로 넘긴 cairn 하나, claude.ai 연결은 끈다.
// 브라우저 작업(browse)에서만 playwright를 더한다 (BrowserMcp: 서버 브라우저에 CDP로, 사이트의 허용 출처만).
// --bare는 쓰지 않는다: CLAUDE_CODE_OAUTH_TOKEN을 읽지 않는다.
// 권한: 셸을 주지 않는다. 내장 도구는 파일 도구만, 쓰기는 acceptEdits라 work 폴더 안에서만, MCP는 cairn만 묻지 않고 허락한다.
// 예외: 코드 러너 칸의 코드 작업은 셸 · 찾기(Bash · Glob · Grep)를 묻지 않고 허락한다. 칸 안의 agent로 돌고 바깥은 허용 목록뿐이다.
// -p는 물을 사람이 없어서 그 밖의 것은 거절된다. 작업 폴더 밖 읽기도 그렇다: Claude가 허락을 묻고, 답할 사람이 없어 거절된다.
// 그래도 주인의 홈은 settings.json의 deny로 막는다 (ClaudeCli.settings): 거절이 더 확실하고 권한 모드가 바뀌어도 남는다.
// 주인의 컴퓨터나 서버의 러너 컨테이너에서 돌아가므로 AI가 지시문에 속아도 이 안에 머문다.
// 로그인 토큰은 일마다 정해지고 (AiLogins), 파일에 쓰지 않고 환경 변수로만 넘긴다.
export class ClaudeCli implements AiTool {
  static readonly TOOL = 'claude';
  private static readonly FILE_TOOLS = ['Read', 'Write', 'Edit'];
  /** 코드 러너 칸의 코드 작업에만 더한다: 셸과 찾기 */
  private static readonly CODE_TOOLS = ['Bash', 'Glob', 'Grep'];
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
    // 코드 러너 칸은 나가는 프록시로만 바깥(모델 API)에 닿는다
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
  ];
  private static readonly HEADLESS_ENV: Readonly<Record<string, string>> = {
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };

  readonly id = ClaudeCli.TOOL;
  /** 이 일에 붙인 브라우저 (어댑터는 일마다 새로 만든다) */
  private browser: BrowserMcp | null = null;
  /** 셸을 여는가: 코드 러너 칸의 자리에서 하는 코드 작업만 */
  private shell = false;

  constructor(
    readonly bin: string,
    private readonly oauthToken: string,
    private readonly mcpUrl: string = '',
    private readonly skillsDir: string = '',
    /** 서버 브라우저의 CDP 주소. 없으면 브라우저 작업에도 붙이지 않는다 */
    private readonly browserUrl: string | null = null,
  ) {}

  /** 작업 자리: work 밖의 mcp.json(작업 토큰), 설정 폴더의 권한 설정과 스킬 */
  open(job: Job, room: CodeRoom | null = null): Promise<JobWorkspace> {
    const { runToken } = job;
    this.browser = runToken === null ? null : BrowserMcp.for(job, this.browserUrl);
    this.shell = job.isCode && room !== null && runToken !== null;
    return JobWorkspace.open(
      runToken === null ? null : ClaudeCli.mcpConfig(this.mcpUrl, runToken, this.browser),
      ClaudeCli.settings(process.env.HOME),
      job.skill,
      this.skillsDir,
      room,
    );
  }

  stream(): AiStream {
    return new ClaudeStream(
      this.browser ? [ClaudeStream.SERVER, BrowserMcp.SERVER] : [ClaudeStream.SERVER],
      this.shell,
    );
  }

  /** setup-token의 토큰은 쓰는 동안 바뀌지 않는다 */
  async changedCredential(): Promise<string | null> {
    return null;
  }

  get secrets(): readonly string[] {
    return [this.oauthToken];
  }

  /** mcp.json의 내용. 이 파일에만 작업 토큰을 쓴다. 브라우저 작업이면 playwright를 더한다 */
  static mcpConfig(url: string, runToken: string, browser: BrowserMcp | null = null): string {
    const servers: Record<string, object> = {
      [ClaudeStream.SERVER]: {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${runToken}` },
      },
    };
    if (browser)
      servers[BrowserMcp.SERVER] = { type: 'stdio', command: browser.command, args: browser.args };
    return JSON.stringify({ mcpServers: servers });
  }

  /**
   * config/settings.json의 내용. 지시문에 속아도 ~/.ssh나 러너의 .env를 읽어 초안에 옮기지 못하게 주인의 홈을 막는다.
   * 작업 폴더 밖 읽기는 물어도 답할 사람이 없어 어차피 거절되지만, deny는 묻지도 않고 권한 모드가 바뀌어도 남는다.
   * HOME은 빈 임시 폴더로 바꾸므로 `~`가 아니라 절대 경로로 적는다. 앞의 //가 절대 경로라는 표시다.
   */
  static settings(ownerHome: string | undefined): string {
    const home = ownerHome?.replace(/\/+$/, '');
    const deny = home ? ClaudeCli.FILE_TOOLS.map((tool) => `${tool}(/${home}/**)`) : [];
    return JSON.stringify({ permissions: { deny } });
  }

  args(workspace: JobWorkspace): readonly string[] {
    const print = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--strict-mcp-config',
    ];
    // 연결 확인: MCP도 도구도 없이 답만 받는다. --tools는 값을 여럿 받으므로 맨 뒤에 둔다
    if (!workspace.mcpReady) return [...print, '--tools', ''];
    const tools = [
      ...ClaudeCli.FILE_TOOLS,
      ...(this.shell ? ClaudeCli.CODE_TOOLS : []),
      ...(workspace.skillReady ? [ClaudeCli.SKILL_TOOL] : []),
    ];
    return [
      ...print,
      '--mcp-config',
      workspace.mcpConfigPath,
      '--tools',
      tools.join(','),
      '--allowedTools',
      `mcp__${ClaudeStream.SERVER}__*`,
      ...(this.browser ? [`mcp__${BrowserMcp.SERVER}__*`] : []),
      ...(workspace.skillReady ? [ClaudeCli.SKILL_TOOL] : []),
      ...(this.shell ? ClaudeCli.CODE_TOOLS : []),
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
      ...(workspace.tmpDir === null ? {} : { TMPDIR: workspace.tmpDir }),
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
      workspace.user,
    );
  }
}
