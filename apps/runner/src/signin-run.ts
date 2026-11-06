import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildExit } from './ai-process';
import { Backoff, pause } from './backoff';
import type { CairnServer, SigninReply } from './cairn-server';
import type { Job } from './job';
import { AccessDenied, ServerUnreachable, ToolRefused } from './mcp-client';
import { RunResult } from './progress';
import type { Redactor, RunLog } from './redactor';
import type { RunnerConfig } from './runner-config';
import { SigninScreen } from './signin-screen';
import { SigninTerminal } from './signin-terminal';

/** 로그인을 어떻게 끝낼지 */
class SigninEnding {
  private constructor(
    readonly note: string,
    /** release_job의 이유 (러너가 멈출 때) */
    readonly releaseReason: string | null,
    /** submit_result failed의 이유 */
    readonly failure: string | null,
  ) {}

  /** 서버는 이미 안다 (자격을 받아 끝냈거나, 주인이 취소했거나, 임대를 잃었다) */
  static quiet(note: string): SigninEnding {
    return new SigninEnding(note, null, null);
  }

  static release(reason: string): SigninEnding {
    return new SigninEnding(reason, reason, null);
  }

  static failed(error: string): SigninEnding {
    return new SigninEnding(error, null, error);
  }
}

// 웹 AI 로그인 하나 (작업 종류 ai_signin). 주인이 AI 메뉴에서 누르면 러너가 로그인 명령을 PTY 안에서 대신 돌린다.
//   claude: setup-token → 주소를 알린다 → 주인이 브라우저에서 받은 코드를 붙여 넣는다 → 러너가 쳐 넣는다 → 1년 토큰
//   codex:  login --device-auth → 주소와 코드를 알린다 → 주인이 주소에서 코드를 넣는다 → CLI가 auth.json을 쓴다
// 2초마다 서버에 물어 코드와 취소를 받는다. 5분 안에 끝나지 않으면 실패. 한 번에 하나 (러너는 일을 하나씩 한다).
// 격리: 빈 홈·설정 폴더, 다른 인증 환경 변수 없이, 브라우저는 열지 않는다(BROWSER=true). 끝나면 폴더를 지운다.
// 화면은 비밀이라 로그에도 기록에도 남기지 않는다. 오류도 화면의 글 대신 정해진 문구로 알린다.
// 나중에 같은 모양이 다시 필요해질 때(Codex 실행) AI CLI 쪽과 공통을 뽑는다 (객체설계 13장).
export class SigninRun {
  private static readonly POLL_MS = 2_000;
  private static readonly TIMEOUT_MS = 5 * 60_000;
  /** 코드를 넣고 Enter를 따로 친다. 함께 보내면 붙여 넣기로 읽혀 제출되지 않는다 (Paperclip) */
  private static readonly ENTER_DELAY_MS = 150;
  private static readonly AUTH_JSON_MAX = 64 * 1024;
  private static readonly STOPPING = '러너가 멈춰요';
  /** 셸이 실행 파일을 찾지 못한 종료 코드 */
  private static readonly NOT_FOUND = 127;
  private static readonly PASSED_ENV = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'USER'];

  constructor(
    private readonly job: Job,
    private readonly server: Pick<CairnServer, 'aiSignin' | 'submit' | 'release'>,
    private readonly config: RunnerConfig,
    private readonly log: RunLog,
    private readonly redactor: Redactor,
    private readonly stop: AbortSignal,
  ) {}

  async perform(): Promise<void> {
    const tool = this.job.tool;
    this.log.info(`${this.job.taskId}: ${tool} 로그인을 시작해요`);
    const bin = this.binOf(tool);
    if (this.stop.aborted) return this.conclude(SigninEnding.release(SigninRun.STOPPING));
    if (bin === null) return this.conclude(SigninEnding.failed(`${tool} 로그인은 지원하지 않아요`));
    if (!SigninTerminal.supported)
      return this.conclude(
        SigninEnding.failed('이 러너의 운영체제에서는 웹 로그인을 할 수 없어요'),
      );
    const dir = await mkdtemp(join(tmpdir(), 'cairn-signin-'));
    try {
      await this.conclude(await this.drive(tool, bin, dir));
    } catch (error) {
      if (error instanceof AccessDenied) throw error;
      await this.conclude(SigninEnding.failed(`러너 오류: ${(error as Error).message}`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private binOf(tool: string): string | null {
    if (tool === 'claude') return this.config.cliPath;
    if (tool === 'codex') return this.config.codexCliPath;
    return null;
  }

  private async drive(tool: string, bin: string, dir: string): Promise<SigninEnding> {
    const home = join(dir, 'home');
    const config = join(dir, 'config');
    await mkdir(home, { mode: 0o700 });
    await mkdir(config, { mode: 0o700 });
    if (tool === 'codex')
      // 열쇠고리가 있는 컴퓨터에서도 auth.json으로 남기게 (러너가 읽어 서버에 넘긴다)
      await writeFile(join(config, 'config.toml'), 'cli_auth_credentials_store = "file"\n', {
        mode: 0o600,
      });
    const screen = new SigninScreen(tool);
    const ended = new AbortController();
    let exit: ChildExit | null = null;
    const terminal = new SigninTerminal(
      bin,
      tool === 'claude' ? ['setup-token'] : ['login', '--device-auth'],
      this.env(tool, home, config),
      (text) => screen.add(text),
    );
    void terminal.exited.then((done) => {
      exit = done;
      ended.abort();
    });
    try {
      return await this.follow(tool, screen, terminal, config, ended.signal, () => exit);
    } finally {
      await terminal.kill();
    }
  }

  /** 화면과 서버의 답을 2초마다 본다. 끝낼 이유가 생기면 돌려준다 */
  private async follow(
    tool: string,
    screen: SigninScreen,
    terminal: SigninTerminal,
    config: string,
    ended: AbortSignal,
    exitOf: () => ChildExit | null,
  ): Promise<SigninEnding> {
    const deadline = Date.now() + SigninRun.TIMEOUT_MS;
    const alarm = AbortSignal.any([this.stop, ended]);
    let shown = false;
    let typed = false;
    for (;;) {
      // 명령이 끝나면 바로 깨어난다. 끝난 뒤에는 다시 보낼 때만 돌므로 서두르지 않는다
      await pause(SigninRun.POLL_MS, exitOf() === null ? alarm : this.stop);
      if (this.stop.aborted) return SigninEnding.release(SigninRun.STOPPING);
      const exit = exitOf();
      const credential = await this.credentialOf(tool, screen, config, exit);
      if (credential !== null) {
        const saved = await this.relay({ credential });
        if (saved instanceof SigninEnding) return saved;
        // 서버에 닿지 못했으면 다음 차례에 다시 보낸다 (화면의 토큰과 auth.json은 그대로 있다)
        if (saved !== null)
          return SigninEnding.quiet(saved.cancelled ? '주인이 취소했어요' : '로그인했어요');
        if (Date.now() > deadline)
          return SigninEnding.failed('서버에 닿지 못해 받은 로그인을 저장하지 못했어요');
        continue;
      }
      if (exit !== null) return SigninEnding.failed(SigninRun.failureOf(tool, exit, shown, typed));
      if (Date.now() > deadline)
        return SigninEnding.failed('5분 안에 로그인을 마치지 못했어요. 다시 시작해 주세요');
      const url = shown ? null : screen.url;
      const reply = await this.relay(url === null ? {} : { url, userCode: screen.userCode });
      if (reply instanceof SigninEnding) return reply;
      if (reply === null) continue;
      if (url !== null) {
        shown = true;
        this.log.info(`${this.job.taskId}: 로그인 주소를 알렸어요`);
      }
      if (reply.cancelled) return SigninEnding.quiet('주인이 취소했어요');
      if (reply.code !== null && !typed) {
        terminal.write(reply.code);
        await pause(SigninRun.ENTER_DELAY_MS);
        terminal.write('\r');
        typed = true;
        this.log.info(`${this.job.taskId}: 붙여 넣은 코드를 넣었어요`);
      }
    }
  }

  /** 받은 자격. Claude는 화면의 토큰, Codex는 잘 끝난 뒤의 auth.json. 아직 없으면 null */
  private async credentialOf(
    tool: string,
    screen: SigninScreen,
    config: string,
    exit: ChildExit | null,
  ): Promise<string | null> {
    if (tool === 'claude') return screen.claudeToken(exit !== null);
    if (exit?.code !== 0) return null;
    try {
      const text = await readFile(join(config, 'auth.json'), 'utf8');
      return text.length > 0 && text.length <= SigninRun.AUTH_JSON_MAX ? text : null;
    } catch {
      return null;
    }
  }

  /**
   * ai_signin 한 번. 서버에 닿지 못하면 null(다음 차례에 다시), 서버가 거절하면 끝낼 이유.
   * 거절 문구는 서버의 것이라 그대로 알린다 (화면의 글이 아니다)
   */
  private async relay(step: {
    url?: string;
    userCode?: string | null;
    credential?: string;
  }): Promise<SigninReply | SigninEnding | null> {
    try {
      return await this.server.aiSignin(this.job.taskId, step);
    } catch (error) {
      if (error instanceof ServerUnreachable) {
        this.log.info(`${this.job.taskId}: 서버에 닿지 못해 다시 물어요`);
        return null;
      }
      if (error instanceof ToolRefused) {
        if (error.code === 'rule_violation' && step.url !== undefined)
          return SigninEnding.failed(`알 수 없는 로그인 화면이에요: ${error.message}`);
        if (error.code === 'rule_violation' && step.credential !== undefined)
          return SigninEnding.failed(`받은 자격의 모양이 아니에요: ${error.message}`);
        return SigninEnding.quiet(`서버가 거절했어요: ${error.message}`);
      }
      throw error;
    }
  }

  /** 로그인 명령만의 환경. 다른 인증 값(ANTHROPIC_API_KEY, OPENAI_API_KEY 등)과 기기 토큰은 넘기지 않는다 */
  private env(tool: string, home: string, config: string): Readonly<Record<string, string>> {
    const passed = SigninRun.PASSED_ENV.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value] as const];
    });
    return {
      ...Object.fromEntries(passed),
      HOME: home,
      TERM: 'xterm-256color',
      BROWSER: 'true',
      ...(tool === 'claude' ? { CLAUDE_CONFIG_DIR: config } : { CODEX_HOME: config }),
    };
  }

  /** 화면의 글은 비밀이 섞일 수 있어 쓰지 않는다. 어느 단계에서 끝났는지로 알린다 */
  private static failureOf(tool: string, exit: ChildExit, shown: boolean, typed: boolean): string {
    if (exit.spawnError !== null) return `로그인 명령을 실행하지 못했어요: ${exit.spawnError}`;
    if (exit.code === SigninRun.NOT_FOUND) return `이 러너에 ${tool} CLI가 없어요`;
    const how = exit.signal ? `신호 ${exit.signal}` : `코드 ${exit.code}`;
    if (!shown) return `로그인 주소를 받기 전에 로그인 명령이 ${how}로 끝났어요`;
    if (tool === 'claude' && typed)
      return `코드가 맞지 않거나 로그인을 마치지 못했어요 (${how}). 다시 시작해 주세요`;
    if (tool === 'codex' && exit.code === 0) return 'Codex가 auth.json을 남기지 않았어요';
    return `로그인 명령이 ${how}로 끝났어요. 다시 시작해 주세요`;
  }

  /** 끝을 알린다. 닿지 못하면 몇 번만 다시: 임대가 끝나면 서버가 어차피 대기열로 돌린다 */
  private async conclude(ending: SigninEnding): Promise<void> {
    this.log.info(`${this.job.taskId}: ${ending.note}`);
    const result = ending.failure === null ? null : RunResult.failed(ending.failure, this.redactor);
    const backoff = new Backoff(1_000, 8_000);
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (ending.releaseReason !== null)
          await this.server.release(this.job.taskId, ending.releaseReason);
        if (result !== null) await this.server.submit(this.job.taskId, result);
        return;
      } catch (error) {
        if (!(error instanceof ServerUnreachable) || attempt >= 3) {
          this.log.info(`${this.job.taskId}: 끝을 알리지 못했어요: ${(error as Error).message}`);
          return;
        }
        await backoff.wait();
      }
    }
  }
}
