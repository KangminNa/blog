import { statSync } from 'node:fs';
import { basename, isAbsolute, resolve, sep } from 'node:path';
import { AgentUser } from './agent-user';
import { SharedFolders } from './shared-folders';

/** 설정이 빠졌거나 틀림. 시작하지 않고 이 문구만 보여 준다 */
export class ConfigProblem extends Error {}

// 러너 설정 (환경 변수). 토큰 값은 오류 문구에 넣지 않는다.
export class RunnerConfig {
  private static readonly DEFAULT_CLI = 'claude';
  private static readonly DEFAULT_CODEX_CLI = 'codex';
  /** apps/runner/src 기준 저장소의 skills/ */
  private static readonly DEFAULT_SKILLS = resolve(__dirname, '../../../skills');
  private static readonly SLOT = /^[1-9][0-9]?$/;
  private static readonly DEFAULT_WORK_DIR = '/work';
  /** 동시에 하는 일의 수 (CAIRN_RUNNER_CONCURRENCY). 서버의 next_jobs는 한 번에 10개까지 빌려 준다 */
  private static readonly CONCURRENCY_MAX = 8;
  /** 서버 러너(연결 값 파일로 스스로 붙는 러너)의 기본값. 내 컴퓨터 러너는 1 */
  private static readonly SERVER_CONCURRENCY = 3;

  constructor(
    /** 끝 슬래시 없는 블로그 주소 */
    readonly serverUrl: string,
    /** run 권한을 준 기기의 토큰. AI CLI에게 주지 않는다. 서버 러너는 비워 두고 연결 값으로 받는다 */
    readonly deviceToken: string | null,
    /** 이 컴퓨터의 AI CLI 로그인. 없으면 콘솔에 넣은 토큰을 일마다 서버에서 받는다 */
    readonly claudeToken: string | null,
    readonly cliPath: string,
    readonly skillsDir: string,
    /**
     * 서버 러너의 연결 값 파일 (서버와 러너만 보는 볼륨). 기기 토큰이 없으면 이 값을 내밀고 토큰을 받는다.
     * 토큰이 있으면 쓰지 않는다
     */
    readonly pairingFile: string | null = null,
    /** Codex CLI. 지금은 웹 로그인(codex login --device-auth)에만 쓴다 */
    readonly codexCliPath: string = RunnerConfig.DEFAULT_CODEX_CLI,
    /** 로그인된 브라우저의 CDP 주소 (browser-tabs 패키지). 없으면 브라우저 탭을 읽지 않는다 */
    readonly browserUrl: string | null = null,
    /**
     * 코드 러너 칸의 번호 (docs/코드작업.md). 있으면 칸 기기로 연결해 코드 작업만 받는다.
     * 코드 러너 이미지(CAIRN_SANDBOX=1)에서 연결 값 파일로만 쓴다
     */
    readonly slot: string | null = null,
    /** 칸에서 AI · setup · checks를 돌릴 사용자 (CAIRN_AGENT_USER). 칸이 아니면 null */
    readonly agentUser: AgentUser | null = null,
    /** 칸의 작업 자리들을 둘 폴더 (CAIRN_WORK_DIR, 기본 /work) */
    readonly workDir: string = RunnerConfig.DEFAULT_WORK_DIR,
    /** 이 러너에 묶인 에이전트에게 나눠 줄 폴더 (CAIRN_RUNNER_FOLDERS, 내 컴퓨터 러너만). 없으면 null */
    readonly folders: SharedFolders | null = null,
    /** 동시에 하는 일의 수 (CAIRN_RUNNER_CONCURRENCY). 코드 러너 칸은 늘 1 */
    readonly concurrency = 1,
  ) {}

  /** uid: 이 프로세스의 사용자 (시험이 바꿔 끼운다) */
  static fromEnv(
    env: Readonly<Record<string, string | undefined>>,
    uid: number = process.getuid?.() ?? -1,
  ): RunnerConfig {
    const token = env.CAIRN_RUNNER_TOKEN?.trim() || null;
    const pairingFile = env.CAIRN_RUNNER_PAIRING_FILE?.trim() || null;
    const missing = [
      ...(env.CAIRN_RUNNER_URL?.trim() ? [] : ['CAIRN_RUNNER_URL']),
      ...(token || pairingFile ? [] : ['CAIRN_RUNNER_TOKEN']),
    ];
    if (missing.length > 0)
      throw new ConfigProblem(`러너 설정이 빠졌어요: ${missing.join(', ')} (.env.example 참고)`);
    const slot = RunnerConfig.slotOf(env, token);
    const paired = token ? null : pairingFile;
    return new RunnerConfig(
      RunnerConfig.address(env.CAIRN_RUNNER_URL ?? ''),
      token,
      env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || null,
      env.CAIRN_RUNNER_CLI?.trim() || RunnerConfig.DEFAULT_CLI,
      env.CAIRN_SKILLS_DIR?.trim() || RunnerConfig.DEFAULT_SKILLS,
      paired,
      env.CAIRN_RUNNER_CODEX_CLI?.trim() || RunnerConfig.DEFAULT_CODEX_CLI,
      env.CAIRN_BROWSER_URL?.trim() ? RunnerConfig.browser(env.CAIRN_BROWSER_URL) : null,
      slot,
      slot === null ? null : RunnerConfig.agentOf(env, uid),
      RunnerConfig.workDirOf(env),
      RunnerConfig.foldersOf(env),
      slot === null ? RunnerConfig.concurrencyOf(env, paired !== null) : 1,
    );
  }

  /** 받은 기기 토큰으로 일하는 설정 (서버 러너가 연결 값으로 토큰을 받은 뒤) */
  withToken(token: string): RunnerConfig {
    return new RunnerConfig(
      this.serverUrl,
      token,
      this.claudeToken,
      this.cliPath,
      this.skillsDir,
      this.pairingFile,
      this.codexCliPath,
      this.browserUrl,
      this.slot,
      this.agentUser,
      this.workDir,
      this.folders,
      this.concurrency,
    );
  }

  get mcpUrl(): string {
    return `${this.serverUrl}/mcp`;
  }

  /**
   * 나눠 줄 폴더 (CAIRN_RUNNER_FOLDERS, 쉼표로 여럿). 내 컴퓨터 러너만 (칸은 셸이 있어 받지 않는다).
   * 절대 경로의 있는 폴더만, 숨김 폴더 · 홈 전체(와 그 위)는 받지 않는다: 홈을 통째로 열면 홈 막기가 뜻이 없다.
   * 이름(마지막 칸)이 겹치면 작업 폴더에서 구별되지 않아 받지 않는다
   */
  private static foldersOf(
    env: Readonly<Record<string, string | undefined>>,
  ): SharedFolders | null {
    const raw = env.CAIRN_RUNNER_FOLDERS?.trim() ?? '';
    if (!raw) return null;
    if (env.CAIRN_SANDBOX === '1')
      throw new ConfigProblem(
        'CAIRN_RUNNER_FOLDERS는 내 컴퓨터 러너에서만 써요 (코드 러너 칸은 안 돼요)',
      );
    const home = env.HOME?.replace(/\/+$/, '') ?? '';
    const paths = raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((path) => {
        if (!isAbsolute(path)) throw new ConfigProblem(`나눌 폴더는 절대 경로예요: ${path}`);
        const full = resolve(path);
        if (
          full === sep ||
          (home && (full === home || `${home}${sep}`.startsWith(`${full}${sep}`)))
        )
          throw new ConfigProblem(`홈 폴더 전체나 그 위는 나눌 수 없어요: ${full}`);
        if (basename(full).startsWith('.'))
          throw new ConfigProblem(`숨김 폴더는 나눌 수 없어요: ${full}`);
        if (!statSync(full, { throwIfNoEntry: false })?.isDirectory())
          throw new ConfigProblem(`나눌 폴더가 없어요: ${full}`);
        return full;
      });
    const names = paths.map((p) => basename(p));
    const twice = names.find((n, i) => names.indexOf(n) !== i);
    if (twice) throw new ConfigProblem(`나눌 폴더의 이름이 겹쳐요: ${twice}`);
    return new SharedFolders(paths);
  }

  /**
   * 칸 번호 (CAIRN_RUNNER_SLOT). 칸은 셸이 있는 일을 받으므로 코드 러너 이미지에서만, 연결 값으로만 붙는다:
   * 내 컴퓨터에서 칸 번호를 잘못 넣어도 시작하지 않는다 (서버도 칸 기기에만 코드 작업을 준다)
   */
  private static slotOf(
    env: Readonly<Record<string, string | undefined>>,
    token: string | null,
  ): string | null {
    const slot = env.CAIRN_RUNNER_SLOT?.trim() || null;
    if (slot === null) return null;
    if (!RunnerConfig.SLOT.test(slot))
      throw new ConfigProblem(`CAIRN_RUNNER_SLOT은 1~99예요: ${slot}`);
    if (env.CAIRN_SANDBOX !== '1')
      throw new ConfigProblem('CAIRN_RUNNER_SLOT은 코드 러너 이미지(CAIRN_SANDBOX=1)에서만 써요');
    if (token !== null || !env.CAIRN_RUNNER_PAIRING_FILE?.trim())
      throw new ConfigProblem(
        '코드 러너 칸은 연결 값 파일(CAIRN_RUNNER_PAIRING_FILE)로만 붙어요. CAIRN_RUNNER_TOKEN은 비워 두세요',
      );
    return slot;
  }

  /**
   * 칸의 AI를 돌릴 사용자. 러너가 root이고 agent가 root가 아닐 때만 벽이 선다 (사용자를 바꾸려면 root가 SETUID를 가져야 한다).
   * self는 시험용: 같은 사용자라 AI가 러너의 연결 값과 메모리를 읽을 수 있다 (러너가 시작할 때 알린다)
   */
  private static agentOf(
    env: Readonly<Record<string, string | undefined>>,
    uid: number,
  ): AgentUser {
    const raw = env.CAIRN_AGENT_USER?.trim() ?? '';
    const agent = AgentUser.parse(raw);
    if (agent === null)
      throw new ConfigProblem(
        `CAIRN_AGENT_USER는 "uid:gid"(예: 1001:1001)나 self(시험용)예요: ${raw || '(비어 있음)'}`,
      );
    if (agent.isSelf) return agent;
    if (uid !== 0)
      throw new ConfigProblem('AI를 다른 사용자로 돌리려면 코드 러너 칸의 러너가 root여야 해요');
    if (agent.uid === 0 || agent.gid === 0)
      throw new ConfigProblem('CAIRN_AGENT_USER는 root가 아닌 사용자여야 해요');
    return agent;
  }

  /**
   * 동시에 하는 일의 수: 1~8. 서버 러너는 기본 3, 내 컴퓨터 러너는 기본 1 (구독 사용량이 그만큼 빨리 찬다).
   * 코드 러너 칸은 부르지 않는다 (칸 하나에 일 하나)
   */
  private static concurrencyOf(
    env: Readonly<Record<string, string | undefined>>,
    serverRunner: boolean,
  ): number {
    const raw = env.CAIRN_RUNNER_CONCURRENCY?.trim() ?? '';
    if (!raw) return serverRunner ? RunnerConfig.SERVER_CONCURRENCY : 1;
    const value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || value < 1 || value > RunnerConfig.CONCURRENCY_MAX)
      throw new ConfigProblem(
        `CAIRN_RUNNER_CONCURRENCY는 1~${RunnerConfig.CONCURRENCY_MAX}예요: ${raw}`,
      );
    return value;
  }

  private static workDirOf(env: Readonly<Record<string, string | undefined>>): string {
    const dir = env.CAIRN_WORK_DIR?.trim() || RunnerConfig.DEFAULT_WORK_DIR;
    if (!isAbsolute(dir) || dir === '/')
      throw new ConfigProblem(`CAIRN_WORK_DIR은 / 밖의 절대 경로여야 해요: ${dir}`);
    return dir.replace(/\/+$/, '');
  }

  /** CDP 주소: 이 컴퓨터나 같은 망의 브라우저만 (http). 끝 슬래시는 뗀다 */
  private static browser(raw: string): string {
    const text = raw.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]/i.test(text) || !URL.canParse(text))
      throw new ConfigProblem(
        `CAIRN_BROWSER_URL은 브라우저의 CDP 주소여야 해요 (예: http://127.0.0.1:9222): ${text}`,
      );
    return text;
  }

  private static address(raw: string): string {
    const text = raw.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]/i.test(text) || !URL.canParse(text))
      throw new ConfigProblem(`CAIRN_RUNNER_URL은 http(s) 주소여야 해요: ${text}`);
    return text;
  }
}
