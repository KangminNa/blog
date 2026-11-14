import { AiLogins } from './ai-login';
import { Backoff } from './backoff';
import { BrowseStage } from './browse-stage';
import { BrowserMcp } from './browser-mcp';
import { BrowserPages } from './browser-page';
import { BrowserSlot } from './browser-slot';
import { BrowserTabs } from './browser-tabs';
import { CairnServer } from './cairn-server';
import { ClickRunner } from './click-runner';
import { CodeStage } from './code-stage';
import type { Job } from './job';
import { JobPool } from './job-pool';
import { CliUnavailable, JobRun } from './job-run';
import { MakeStage } from './make-stage';
import { AccessDenied, McpClient, ToolRefused } from './mcp-client';
import { NoteStage } from './note-stage';
import { RunResult } from './progress';
import { Redactor, RunLog } from './redactor';
import { RunnerAbility } from './runner-ability';
import type { RunnerConfig } from './runner-config';
import { SandboxRoom } from './sandbox-room';
import type { SandboxStage } from './sandbox-stage';
import { SigninRun } from './signin-run';
import { TabReader } from './tab-reader';

/** 다시 시도해도 소용없음: 토큰이나 설치를 사람이 고쳐야 한다 */
export class RunnerHalted extends Error {}

/** 서버가 기기 토큰을 거절함 (끊겼거나 바뀜). 서버 러너는 연결 값으로 다시 받고, 그 밖의 러너는 멈춘다 */
export class TokenRejected extends RunnerHalted {}

// 러너의 고리: 빈 자리만큼 일을 빌리고(next_jobs의 limit), 일마다 따로 끝까지 처리하고, 자리가 비면 다시 빌린다.
// 동시에 하는 일의 수는 CAIRN_RUNNER_CONCURRENCY (서버 러너 기본 3, 내 컴퓨터 러너 1, 코드 러너 칸은 늘 1. JobPool).
// 서버에 닿지 못하면 간격을 늘려 다시 묻는다. 들어오는 포트 없이 나가는 요청만 쓴다 (객체설계 13장 임대 큐).
// 이 러너가 할 수 있는 것(가진 AI CLI, 웹 로그인, 스스로 가진 로그인)을 next_jobs로 알리면 서버가 할 수 있는 일만 준다:
// 로그인이 없는 도구의 일은 빌렸다 돌려주지 않고 대기열에 남는다. 웹 로그인은 토큰 없이 돈다 (SigninRun).
// 연결 확인은 우선순위가 가장 높아 토큰이 돌아오면 가장 먼저 빌려진다. 러너는 빌리지 않고는 대기열을 볼 수 없다.
export class Runner {
  /** next_jobs가 기다리는 시간. 서버의 NextJobsInput.WAIT_MAX */
  private static readonly WAIT_SECONDS = 25;
  private static readonly BACKOFF_FIRST_MS = 1_000;
  private static readonly BACKOFF_MAX_MS = 60_000;
  /** 일을 빌린 뒤에 토큰을 받지 못했을 때. 돌려준 일이 바로 다시 빌려지므로 쉬지 않으면 빌리고 돌려주기를 되풀이한다 */
  private static readonly LOGIN_WAIT_FIRST_MS = 5_000;
  private static readonly LOGIN_WAIT_MAX_MS = 120_000;
  /** 브라우저 작업을 빌렸는데 브라우저에 닿지 못했을 때. 돌려준 일이 바로 다시 오므로 쉬어야 한다 */
  private static readonly BROWSER_WAIT_FIRST_MS = 5_000;
  private static readonly BROWSER_WAIT_MAX_MS = 120_000;
  /** 코드 작업을 빌렸는데 저장소에 닿지 못했을 때. 돌려준 일이 바로 다시 오므로 쉬어야 한다 */
  private static readonly REPO_WAIT_FIRST_MS = 10_000;
  private static readonly REPO_WAIT_MAX_MS = 300_000;

  private readonly stopper = new AbortController();
  private readonly pollCutter = new AbortController();
  private polling = false;
  /** 사람이 고쳐야 해서 멈춘 까닭 (일이나 일 빌리기에서). 도는 일을 모두 돌려준 뒤 run()이 던진다 */
  private halt: RunnerHalted | null = null;
  /**
   * 새 일을 빌리지 않고 쉬는 동안. 돌려준 일은 바로 다시 빌려지므로 쉬지 않으면 빌리고 돌려주기를 되풀이한다.
   * 일마다 겹치면 가장 늦은 때까지
   */
  private hold: Promise<void> = Promise.resolve();
  private readonly backoff = new Backoff(Runner.BACKOFF_FIRST_MS, Runner.BACKOFF_MAX_MS);
  /** next_jobs가 되는 동안에도 늘어나야 해서 backoff와 따로 센다 */
  private readonly loginWait = new Backoff(Runner.LOGIN_WAIT_FIRST_MS, Runner.LOGIN_WAIT_MAX_MS);
  private readonly browserWait = new Backoff(
    Runner.BROWSER_WAIT_FIRST_MS,
    Runner.BROWSER_WAIT_MAX_MS,
  );
  private readonly repoWait = new Backoff(Runner.REPO_WAIT_FIRST_MS, Runner.REPO_WAIT_MAX_MS);
  private readonly redactor: Redactor;
  private readonly log: RunLog;
  private readonly server: CairnServer;
  private readonly logins: AiLogins;
  private readonly ability: RunnerAbility;
  /** 서버 브라우저의 로그인된 프로필을 쓰는 자리: 사이트 일과 결재된 클릭이 하나씩 (BrowseStage · ClickRunner) */
  private readonly slot = new BrowserSlot();
  private readonly pages: BrowserPages | null;

  constructor(private readonly config: RunnerConfig) {
    const token = config.deviceToken;
    if (!token) throw new RunnerHalted('기기 토큰 없이 러너를 시작할 수 없어요');
    this.redactor = new Redactor([token, config.claudeToken]);
    this.log = new RunLog(this.redactor);
    this.server = new CairnServer(new McpClient(config.mcpUrl, token));
    this.logins = new AiLogins(this.server, config.claudeToken);
    this.ability = RunnerAbility.detect(config);
    this.pages = config.browserUrl ? new BrowserPages(config.browserUrl) : null;
  }

  /**
   * 멈추라고 알린다. 돌던 AI CLI를 끄고 일을 돌려준 뒤 run()이 끝난다.
   * 도는 일이 여럿이면 모두 끄고 돌려준다. 기다리는 next_jobs는 끊지 않는다: 끊겨도 서버는 시간이 다 될 때까지 찾다가 없는 러너에게 일을 빌려 주고,
   * 그 일은 임대가 끝날 때까지 15분을 묶인다. 끝까지 받으면 일이 와도 돌려줄 수 있다. 두 번째 stop()은 바로 끊는다.
   */
  stop(): void {
    if (this.stopper.signal.aborted) {
      this.pollCutter.abort();
      return;
    }
    this.stopper.abort();
    if (this.polling) this.log.info('기다리는 요청이 끝나면 멈춰요. 바로 끝내려면 한 번 더');
  }

  /** stop()까지 돈다. 사람이 고쳐야 하는 문제면 RunnerHalted */
  async run(): Promise<void> {
    const stop = this.stopper.signal;
    this.log.info(`러너를 시작했어요: ${this.config.serverUrl}`);
    const swept = await SigninRun.sweep();
    if (swept > 0) this.log.info(`지난번에 남은 로그인 폴더 ${swept}개를 지웠어요`);
    this.log.info(this.ability.line);
    if (this.config.concurrency > 1)
      this.log.info(`동시에 하는 일: ${this.config.concurrency}개까지`);
    const agent = this.config.agentUser;
    if (this.ability.sandbox && agent) {
      if (agent.isSelf)
        this.log.info('AI가 러너와 같은 사용자로 돌아요 (시험용). 칸에서는 쓰지 마세요');
      const rooms = await SandboxRoom.sweep(this.config.workDir, agent);
      if (rooms > 0) this.log.info(`지난번에 남은 작업 자리 ${rooms}개를 지웠어요`);
    }
    if (this.ability.tools.length === 0 && this.ability.signinTools.length === 0)
      this.log.info('이 컴퓨터에서 쓸 수 있는 AI CLI가 없어요. 설치한 뒤 러너를 다시 켜 주세요');
    if (this.config.claudeToken === null)
      this.log.info(
        'AI 로그인은 콘솔의 AI 메뉴에서 해요. 로그인이 없는 도구의 일은 서버가 주지 않아요',
      );
    // 브라우저가 있으면 탭 읽기와, 서버 러너면 결재된 클릭(browser-tabs 패키지)을 일과 따로 돌린다.
    // 거기서 토큰이 거절되면 일의 고리도 멈추고, 일의 고리가 끝나면(멈춤 · 오류) 그것들도 끝낸다
    let tabFailure: unknown = null;
    const aside = (error: unknown) => {
      tabFailure = error;
      this.stopper.abort();
      this.pollCutter.abort();
    };
    const { browserUrl } = this.config;
    const tabs = browserUrl
      ? new TabReader(this.server, new BrowserTabs(browserUrl), this.log).run(stop).catch(aside)
      : null;
    const clicks =
      this.pages && this.ability.browser
        ? new ClickRunner(this.server, this.pages, this.slot, this.log).run(stop).catch(aside)
        : null;
    try {
      await this.loop(stop);
    } finally {
      this.stopper.abort();
      await Promise.all([tabs, clicks]);
    }
    if (tabFailure instanceof AccessDenied) throw new TokenRejected(tabFailure.message);
    if (tabFailure) throw new RunnerHalted((tabFailure as Error).message);
    if (this.halt) throw this.halt;
    this.log.info('러너를 멈췄어요');
  }

  /** 빈 자리만큼 일을 빌려 처리하기를 stop까지 되풀이하고, 도는 일이 모두 끝나기(돌려주기)를 기다린다 */
  private async loop(stop: AbortSignal): Promise<void> {
    const pool = new JobPool(this.config.concurrency);
    try {
      while (!stop.aborted) {
        await pool.vacancy(stop);
        await this.hold;
        if (stop.aborted) break;
        await this.lease(pool);
      }
    } finally {
      await pool.drain();
    }
  }

  /** 빈 자리만큼 빌린다. 사이트 일(대상이 있는 브라우저 작업)이 도는 동안은 브라우저를 알리지 않는다 (JobPool) */
  private async lease(pool: JobPool): Promise<void> {
    try {
      this.polling = true;
      const jobs = await this.server.nextJobs(
        Runner.WAIT_SECONDS,
        pool.free,
        this.pollCutter.signal,
        pool.browserBusy ? this.ability.withoutBrowser() : this.ability,
      );
      this.backoff.reset();
      for (const job of jobs)
        pool.add(
          this.perform(job).catch((error: unknown) => this.failed(error)),
          job.isBrowse && job.target !== null,
        );
    } catch (error) {
      this.failed(error);
    } finally {
      this.polling = false;
    }
  }

  /**
   * 일이나 일 빌리기의 실패. 사람이 고쳐야 하는 것(토큰 · 권한 · CLI)이면 러너를 멈춘다: 도는 일을 모두 돌려준 뒤 run()이 던진다.
   * 아니면 남기고 쉬었다가 다시 빌린다. 멈추는 중의 실패는 무시한다
   */
  private failed(error: unknown): void {
    if (this.stopper.signal.aborted) return;
    if (Runner.fatal(error)) {
      const message = (error as Error).message;
      this.halt =
        error instanceof AccessDenied ? new TokenRejected(message) : new RunnerHalted(message);
      this.stopper.abort();
      this.pollCutter.abort();
      return;
    }
    this.log.info(`다시 시도해요: ${(error as Error).message}`);
    this.pauseLeasing(this.backoff);
  }

  /** 새 일 빌리기를 backoff만큼 쉰다 (돌던 다른 일은 그대로 간다) */
  private pauseLeasing(backoff: Backoff): void {
    const before = this.hold;
    const wait = backoff.wait(this.stopper.signal);
    this.hold = Promise.all([before, wait]).then(() => {});
  }

  private async perform(job: Job): Promise<void> {
    const who = job.agentName ? `(${job.agentName}) ` : '';
    this.log.info(`${job.taskId}: 일을 맡았어요 ${who}${job.title}`);
    if (job.isAiSignin) {
      const signin = new SigninRun(
        job,
        this.server,
        this.config,
        this.log,
        this.redactor,
        this.stopper.signal,
      );
      return signin.perform();
    }
    let stage: SandboxStage | null = null;
    if (job.sandboxed) {
      // 코드 · 만들기 작업은 칸 안에서 셸과 함께 한다 (CodeStage · MakeStage). 칸이 아닌 러너는 서버가 주지 않지만 여기서도 막는다:
      // AI를 띄우지 않고 실패로 끝낸다 (돌려주면 같은 러너가 곧바로 다시 빌려 끝없이 돈다)
      const agent = this.config.agentUser;
      if (!this.ability.sandbox || agent === null) {
        const why = '코드 러너 칸이 아니라서 셸이 필요한 일을 하지 않아요';
        this.log.info(`${job.taskId}: ${why}`);
        return this.server.submit(job.taskId, RunResult.failed(why, this.redactor));
      }
      stage = job.isMake
        ? new MakeStage(job, this.config, agent, this.log, this.server)
        : new CodeStage(job, this.config, agent, this.log, this.server);
    }
    if (job.isBrowse) {
      // 브라우저가 꺼졌거나 다시 뜨는 중이면 AI를 띄우지 않고 돌려준다 (실패로 끝내지 않는다)
      if (!(await BrowserMcp.reachable(this.config.browserUrl))) {
        this.log.info(`${job.taskId}: 브라우저에 닿지 못해 돌려줘요`);
        await this.server.release(job.taskId, '브라우저에 닿지 못해요. 다시 뜨면 이어서 해요');
        return this.pauseLeasing(this.browserWait);
      }
      this.browserWait.reset();
      // 어디서 일할지 받고 마지막 버튼 · 로그인을 러너가 맡는다 (BrowseStage)
      stage = new BrowseStage(job, this.config, this.server, this.slot, this.pages as BrowserPages);
    }
    // 세션 노트: 원문을 받아 틀을 채우고, 답을 vault에 보낸다 (NoteStage)
    if (job.writesNote) stage = new NoteStage(job, this.server);
    const login = await this.logins.forJob(job);
    await new JobRun(
      job,
      login,
      this.server,
      this.config,
      this.log,
      this.redactor,
      this.stopper.signal,
      stage,
    ).perform();
    if (login.token === null) this.pauseLeasing(this.loginWait);
    else this.loginWait.reset();
    if (stage?.unreachable) this.pauseLeasing(this.repoWait);
    else if (stage) this.repoWait.reset();
  }

  private static fatal(error: unknown): boolean {
    return (
      error instanceof AccessDenied ||
      error instanceof CliUnavailable ||
      (error instanceof ToolRefused && error.code === 'forbidden')
    );
  }
}
