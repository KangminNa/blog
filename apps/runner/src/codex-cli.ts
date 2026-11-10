import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AiProcess } from './ai-process';
import type { AiStream, AiTool } from './ai-tool';
import { BrowserMcp } from './browser-mcp';
import type { CodeRoom } from './code-room';
import { CodexStream } from './codex-stream';
import type { Job } from './job';
import { JobWorkspace } from './job-workspace';

// Codex CLI를 부르는 법: 공식 `codex exec --json`을 ChatGPT 구독 로그인(auth.json)으로 그대로 띄운다.
//
// 격리: CODEX_HOME은 작업마다 새 설정 폴더(config/)라 사용자의 설정 · MCP · 규칙 · 기록을 물려받지 않는다.
// 권한: 셸을 끈다 (features.shell_tool · unified_exec). 남는 것은 작업 폴더 안 파일 고치기(apply_patch)와 cairn MCP뿐이다.
//       sandbox는 workspace-write(작업 폴더만 쓰기, 네트워크 없음)로 둔다: 셸이 다시 열려도 두 번째 벽이 되게.
//       읽기는 sandbox가 막지 않아서(실험으로 확인) 셸을 끄는 것이 첫 벽이다.
//       --strict-config: 설정 이름이 바뀐 버전이면 셸이 조용히 열리지 않고 시작부터 실패한다.
// 스킬: 셸이 없어 SKILL.md를 스스로 읽지 못하므로 지시문에 넣는다.
// MCP: cairn 하나. 작업 토큰은 환경 변수(CAIRN_RUN_TOKEN)로만 넘기고, 셸 명령에는 기본만 넘긴다(shell_environment_policy).
// 자격: auth.json은 쓸 때 갱신 토큰이 바뀐다. 끝난 뒤 바뀌었으면 서버에 되돌려 쓴다 (changedCredential → ai_login_refresh).
// 설정 값은 Codex 0.164.0의 --strict-config로 이름을 확인했다.
export class CodexCli implements AiTool {
  static readonly TOOL = 'codex';
  private static readonly TOKEN_ENV = 'CAIRN_RUN_TOKEN';
  /** 사용자 환경에서 넘기는 것. 나머지(기기 토큰, 다른 API 키 포함)는 Codex에게 가지 않는다 */
  private static readonly PASSED_ENV = [
    'PATH',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'TMPDIR',
    'USER',
    // 코드 러너 칸은 나가는 프록시로만 바깥(모델 API)에 닿는다
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
  ];
  /** auth.json의 크기 한도 (되돌려 쓸 때 읽는다) */
  private static readonly AUTH_MAX = 64 * 1024;
  /** auth.json 안에서 로그에서 지울 만큼 긴 값 (토큰) */
  private static readonly SECRET_MIN = 16;

  readonly id = CodexCli.TOOL;

  constructor(
    readonly bin: string,
    /** auth.json 원문 */
    private readonly authJson: string,
    private readonly mcpUrl: string,
    private readonly skillsDir: string,
    /** 서버 브라우저의 CDP 주소. 없으면 브라우저 작업에도 붙이지 않는다 */
    private readonly browserUrl: string | null = null,
  ) {}

  /** 이 일에 붙인 브라우저 (어댑터는 일마다 새로 만든다) */
  private browser: BrowserMcp | null = null;
  /** 셸을 여는가: 코드 러너 칸의 자리에서 하는 코드 작업만 */
  private shell = false;

  /**
   * CODEX_HOME/config.toml. 이 코드의 고정된 값과 서버 주소뿐이다. mcpUrl이 없으면 MCP 없이 (연결 확인).
   * 브라우저 작업이면 playwright를 더한다 (셸은 그대로 꺼져 있다)
   */
  static configToml(
    mcpUrl: string | null,
    browser: BrowserMcp | null = null,
    shell = false,
  ): string {
    // 셸을 연 코드 작업: Codex의 sandbox는 끄고 칸이 벽이다 (Claude Code와 같은 조건. Docker 안에서 Codex sandbox가 도는지도 불확실).
    // 셸 명령은 Codex가 받은 환경(프록시 · 칸의 홈)을 그대로 쓴다
    const sandbox = shell
      ? ['sandbox_mode = "danger-full-access"']
      : ['sandbox_mode = "workspace-write"'];
    const lines = [
      '# Cairn 러너가 작업마다 만든 설정. 작업이 끝나면 지운다',
      'cli_auth_credentials_store = "file"',
      'approval_policy = "never"',
      ...sandbox,
      'web_search = "disabled"',
      ...(shell ? [] : ['', '[sandbox_workspace_write]', 'network_access = false']),
      '',
      '[shell_environment_policy]',
      `inherit = "${shell ? 'all' : 'core'}"`,
      '',
      '[features]',
      `shell_tool = ${shell}`,
      'unified_exec = false',
      'view_image = false',
    ];
    if (mcpUrl !== null)
      lines.push(
        '',
        `[mcp_servers.${CodexStream.SERVER}]`,
        `url = ${JSON.stringify(mcpUrl)}`,
        `bearer_token_env_var = "${CodexCli.TOKEN_ENV}"`,
      );
    if (mcpUrl !== null && browser)
      lines.push(
        '',
        `[mcp_servers.${BrowserMcp.SERVER}]`,
        `command = ${JSON.stringify(browser.command)}`,
        `args = [${browser.args.map((a) => JSON.stringify(a)).join(', ')}]`,
      );
    return `${lines.join('\n')}\n`;
  }

  async open(job: Job, room: CodeRoom | null = null): Promise<JobWorkspace> {
    const workspace = await JobWorkspace.open(null, null, null, this.skillsDir, room);
    const mcp = job.runToken === null ? null : this.mcpUrl;
    this.browser = mcp === null ? null : BrowserMcp.for(job, this.browserUrl);
    this.shell = job.isCode && room !== null && mcp !== null;
    await writeFile(
      join(workspace.configDir, 'config.toml'),
      CodexCli.configToml(mcp, this.browser, this.shell),
      {
        mode: 0o600,
      },
    );
    await writeFile(join(workspace.configDir, 'auth.json'), this.authJson, { mode: 0o600 });
    return workspace;
  }

  args(workspace: JobWorkspace): readonly string[] {
    return [
      'exec',
      '--json',
      '--strict-config',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      this.shell ? 'danger-full-access' : 'workspace-write',
      '--cd',
      workspace.workDir,
      '-',
    ];
  }

  env(
    job: Job,
    workspace: JobWorkspace,
    parent: Readonly<Record<string, string | undefined>>,
  ): Readonly<Record<string, string>> {
    const passed = CodexCli.PASSED_ENV.flatMap((name) => {
      const value = parent[name];
      return value === undefined ? [] : [[name, value] as const];
    });
    return {
      ...Object.fromEntries(passed),
      HOME: workspace.homeDir,
      ...(workspace.tmpDir === null ? {} : { TMPDIR: workspace.tmpDir }),
      CODEX_HOME: workspace.configDir,
      ...(job.runToken === null ? {} : { [CodexCli.TOKEN_ENV]: job.runToken }),
    };
  }

  start(job: Job, workspace: JobWorkspace, onLine: (line: string) => void): AiProcess {
    // 서버가 실어 보낸 판이 먼저, 옛 서버면 디스크의 skills/
    const skill =
      job.skillPackage?.skillMd ??
      (job.skill === null ? null : JobWorkspace.skillText(job.skill, this.skillsDir));
    return new AiProcess(
      this.bin,
      this.args(workspace),
      workspace.workDir,
      this.env(job, workspace, process.env),
      job.prompt(false, skill),
      onLine,
      workspace.user,
    );
  }

  stream(): AiStream {
    return new CodexStream(
      this.browser ? [CodexStream.SERVER, BrowserMcp.SERVER] : [CodexStream.SERVER],
      this.shell,
    );
  }

  async changedCredential(workspace: JobWorkspace): Promise<string | null> {
    const now = await workspace.readConfig('auth.json', CodexCli.AUTH_MAX);
    return now !== null && now.trim() !== '' && now !== this.authJson ? now : null;
  }

  /** auth.json 안의 토큰들 (access · refresh · id). 모양이 바뀌어도 긴 문자열은 모두 지운다 */
  get secrets(): readonly string[] {
    const found: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string' && value.length >= CodexCli.SECRET_MIN) found.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    try {
      walk(JSON.parse(this.authJson));
    } catch {
      found.push(this.authJson);
    }
    return found;
  }
}
