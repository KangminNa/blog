import { AiLogins } from './ai-login';
import { Backoff } from './backoff';
import { BrowserMcp } from './browser-mcp';
import { BrowserTabs } from './browser-tabs';
import { CairnServer } from './cairn-server';
import type { Job } from './job';
import { CliUnavailable, JobRun } from './job-run';
import { AccessDenied, McpClient, ToolRefused } from './mcp-client';
import { Redactor, RunLog } from './redactor';
import { RunnerAbility } from './runner-ability';
import type { RunnerConfig } from './runner-config';
import { SigninRun } from './signin-run';
import { TabReader } from './tab-reader';

/** 다시 시도해도 소용없음: 토큰이나 설치를 사람이 고쳐야 한다 */
export class RunnerHalted extends Error {}

/** 서버가 기기 토큰을 거절함 (끊겼거나 바뀜). 서버 러너는 연결 값으로 다시 받고, 그 밖의 러너는 멈춘다 */
export class TokenRejected extends RunnerHalted {}

// 러너의 고리: 일을 하나 빌리고, 끝까지 처리하고, 다시 빌린다. 한 번에 일 하나.
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

  private readonly stopper = new AbortController();
  private readonly pollCutter = new AbortController();
  private polling = false;
  private readonly backoff = new Backoff(Runner.BACKOFF_FIRST_MS, Runner.BACKOFF_MAX_MS);
  /** next_jobs가 되는 동안에도 늘어나야 해서 backoff와 따로 센다 */
  private readonly loginWait = new Backoff(Runner.LOGIN_WAIT_FIRST_MS, Runner.LOGIN_WAIT_MAX_MS);
  private readonly browserWait = new Backoff(
    Runner.BROWSER_WAIT_FIRST_MS,
    Runner.BROWSER_WAIT_MAX_MS,
  );
  private readonly redactor: Redactor;
  private readonly log: RunLog;
  private readonly server: CairnServer;
  private readonly logins: AiLogins;
  private readonly ability: RunnerAbility;

  constructor(private readonly config: RunnerConfig) {
    const token = config.deviceToken;
    if (!token) throw new RunnerHalted('기기 토큰 없이 러너를 시작할 수 없어요');
    this.redactor = new Redactor([token, config.claudeToken]);
    this.log = new RunLog(this.redactor);
    this.server = new CairnServer(new McpClient(config.mcpUrl, token));
    this.logins = new AiLogins(this.server, config.claudeToken);
    this.ability = RunnerAbility.detect(config);
  }

  /**
   * 멈추라고 알린다. 돌던 AI CLI를 끄고 일을 돌려준 뒤 run()이 끝난다.
   * 기다리는 next_jobs는 끊지 않는다: 끊겨도 서버는 시간이 다 될 때까지 찾다가 없는 러너에게 일을 빌려 주고,
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
    if (this.ability.tools.length === 0 && this.ability.signinTools.length === 0)
      this.log.info('이 컴퓨터에서 쓸 수 있는 AI CLI가 없어요. 설치한 뒤 러너를 다시 켜 주세요');
    if (this.config.claudeToken === null)
      this.log.info(
        'AI 로그인은 콘솔의 AI 메뉴에서 해요. 로그인이 없는 도구의 일은 서버가 주지 않아요',
      );
    // 브라우저가 있으면 탭 읽기(browser-tabs 패키지)를 일과 따로 돌린다.
    // 탭 읽기에서 토큰이 거절되면 일의 고리도 멈추고, 일의 고리가 끝나면(멈춤 · 오류) 탭 읽기도 끝낸다
    let tabFailure: unknown = null;
    const tabs = this.config.browserUrl
      ? new TabReader(this.server, new BrowserTabs(this.config.browserUrl), this.log)
          .run(stop)
          .catch((error: unknown) => {
            tabFailure = error;
            this.stopper.abort();
            this.pollCutter.abort();
          })
      : null;
    try {
      await this.loop(stop);
    } finally {
      this.stopper.abort();
      await tabs;
    }
    if (tabFailure instanceof AccessDenied) throw new TokenRejected(tabFailure.message);
    if (tabFailure) throw new RunnerHalted((tabFailure as Error).message);
    this.log.info('러너를 멈췄어요');
  }

  /** 일을 빌려 처리하기를 stop까지 되풀이한다 */
  private async loop(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) {
      try {
        this.polling = true;
        const jobs = await this.server.nextJobs(
          Runner.WAIT_SECONDS,
          this.pollCutter.signal,
          this.ability,
        );
        this.polling = false;
        this.backoff.reset();
        for (const job of jobs) await this.perform(job);
      } catch (error) {
        this.polling = false;
        if (stop.aborted) break;
        if (error instanceof AccessDenied) throw new TokenRejected(error.message);
        if (Runner.fatal(error)) throw new RunnerHalted((error as Error).message);
        this.log.info(`다시 시도해요: ${(error as Error).message}`);
        await this.backoff.wait(stop);
      }
    }
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
    if (job.isBrowse) {
      // 브라우저가 꺼졌거나 다시 뜨는 중이면 AI를 띄우지 않고 돌려준다 (실패로 끝내지 않는다)
      if (!(await BrowserMcp.reachable(this.config.browserUrl))) {
        this.log.info(`${job.taskId}: 브라우저에 닿지 못해 돌려줘요`);
        await this.server.release(job.taskId, '브라우저에 닿지 못해요. 다시 뜨면 이어서 해요');
        return this.browserWait.wait(this.stopper.signal);
      }
      this.browserWait.reset();
    }
    const login = await this.logins.forJob(job);
    await new JobRun(
      job,
      login,
      this.server,
      this.config,
      this.log,
      this.redactor,
      this.stopper.signal,
    ).perform();
    if (login.token === null) await this.loginWait.wait(this.stopper.signal);
    else this.loginWait.reset();
  }

  private static fatal(error: unknown): boolean {
    return (
      error instanceof AccessDenied ||
      error instanceof CliUnavailable ||
      (error instanceof ToolRefused && error.code === 'forbidden')
    );
  }
}
