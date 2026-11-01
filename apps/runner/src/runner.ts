import { Backoff } from './backoff';
import { CairnServer } from './cairn-server';
import type { Job } from './job';
import { CliUnavailable, JobRun } from './job-run';
import { AccessDenied, McpClient, ToolRefused } from './mcp-client';
import { Redactor, RunLog } from './redactor';
import type { RunnerConfig } from './runner-config';

/** 다시 시도해도 소용없음: 토큰이나 설치를 사람이 고쳐야 한다 */
export class RunnerHalted extends Error {}

// 러너의 고리: 일을 하나 빌리고, 끝까지 처리하고, 다시 빌린다. 한 번에 일 하나.
// 서버에 닿지 못하면 간격을 늘려 다시 묻는다. 들어오는 포트 없이 나가는 요청만 쓴다 (객체설계 13장 임대 큐).
export class Runner {
  /** next_jobs가 기다리는 시간. 서버의 NextJobsInput.WAIT_MAX */
  private static readonly WAIT_SECONDS = 25;
  private static readonly BACKOFF_FIRST_MS = 1_000;
  private static readonly BACKOFF_MAX_MS = 60_000;

  private readonly stopper = new AbortController();
  private readonly pollCutter = new AbortController();
  private polling = false;
  private readonly backoff = new Backoff(Runner.BACKOFF_FIRST_MS, Runner.BACKOFF_MAX_MS);
  private readonly redactor: Redactor;
  private readonly log: RunLog;
  private readonly server: CairnServer;

  constructor(private readonly config: RunnerConfig) {
    this.redactor = new Redactor([config.deviceToken, config.claudeToken]);
    this.log = new RunLog(this.redactor);
    this.server = new CairnServer(new McpClient(config.mcpUrl, config.deviceToken));
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
    while (!stop.aborted) {
      try {
        this.polling = true;
        const jobs = await this.server.nextJobs(Runner.WAIT_SECONDS, this.pollCutter.signal);
        this.polling = false;
        this.backoff.reset();
        for (const job of jobs) await this.perform(job);
      } catch (error) {
        this.polling = false;
        if (stop.aborted) break;
        if (Runner.fatal(error)) throw new RunnerHalted((error as Error).message);
        this.log.info(`다시 시도해요: ${(error as Error).message}`);
        await this.backoff.wait(stop);
      }
    }
    this.log.info('러너를 멈췄어요');
  }

  private perform(job: Job): Promise<void> {
    this.log.info(`${job.taskId}: 일을 맡았어요 (${job.agentName}) ${job.title}`);
    return new JobRun(
      job,
      this.server,
      this.config,
      this.log,
      this.redactor,
      this.stopper.signal,
    ).perform();
  }

  private static fatal(error: unknown): boolean {
    return (
      error instanceof AccessDenied ||
      error instanceof CliUnavailable ||
      (error instanceof ToolRefused && error.code === 'forbidden')
    );
  }
}
