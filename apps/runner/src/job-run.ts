import type { AiLogin } from './ai-login';
import type { AiProcess, ChildExit } from './ai-process';
import { type AiStream, type AiTool, AiTools } from './ai-tool';
import { Backoff, pause } from './backoff';
import type { CairnServer } from './cairn-server';
import type { Job } from './job';
import { JobWorkspace } from './job-workspace';
import { AccessDenied, ServerUnreachable, ToolRefused } from './mcp-client';
import { ProgressState, RunResult } from './progress';
import { ProgressReporter } from './progress-reporter';
import type { Redactor, RunLog } from './redactor';
import type { RunnerConfig } from './runner-config';

/** AI CLI를 실행조차 못 함. 일마다 똑같이 실패할 테니 러너를 멈춘다 */
export class CliUnavailable extends Error {}

/** 실행을 어떻게 끝낼지. 서버에 보낼 것이 없으면 note만 남긴다 */
class RunEnding {
  private constructor(
    readonly note: string,
    /** release_job의 이유 */
    readonly releaseReason: string | null,
    /** submit_result */
    readonly result: RunResult | null,
  ) {}

  static quiet(note: string): RunEnding {
    return new RunEnding(note, null, null);
  }

  static release(reason: string): RunEnding {
    return new RunEnding(reason, reason, null);
  }

  static submit(note: string, result: RunResult): RunEnding {
    return new RunEnding(note, null, result);
  }
}

// 일 하나의 처음부터 끝까지: 자리를 만들고, AI CLI를 띄우고, 기록을 보내며 서버의 답을 보고, 끝을 알리고, 자리를 지운다.
//
// 서버의 답 (report_progress):
//   cancelled     → 끄고 끝. 주인이 멈췄으니 제출하지 않는다
//   waiting       → 끄고 끝. 에이전트가 결재를 올렸으니 제출하지 않는다 (서버는 waiting에 대한 제출을 거절한다)
//   paused        → 끄고 돌려준다 (release_job). 에이전트가 다시 움직이면 다른 실행이 맡는다
//   거절           → 끄고 끝. 임대를 잃었으니 이 일은 이제 이 러너의 것이 아니다
// AI CLI가 스스로 끝나면 남은 기록을 먼저 보내고 답을 본 뒤 제출한다: 결재를 올리자마자 끝난 실행을 done으로 보내면 안 된다.
export class JobRun {
  private static readonly REPORT_MS = 3_000;
  private static readonly RETRY_FIRST_MS = 1_000;
  private static readonly RETRY_MAX_MS = 30_000;
  /** 멈추는 중에는 서버가 답하지 않아도 이만큼만 더 시도한다 */
  private static readonly STOP_RETRY_MS = 5_000;
  private static readonly STOPPING = '러너가 멈춰요';
  private static readonly PAUSED = '에이전트가 멈췄어요';

  private readonly redactor: Redactor;
  private readonly reporter: ProgressReporter;
  /** 일의 도구 어댑터. 토큰이 없거나 모르는 도구면 null (perform이 시작 전에 끝낸다) */
  private readonly tool: AiTool | null;

  constructor(
    private readonly job: Job,
    private readonly login: AiLogin,
    private readonly server: CairnServer,
    private readonly config: RunnerConfig,
    private readonly log: RunLog,
    redactor: Redactor,
    private readonly stop: AbortSignal,
  ) {
    this.tool = login.token === null ? null : AiTools.for(job.tool, login.token, config);
    // 자격 안의 토큰까지 (Codex auth.json의 access · refresh) 로그와 기록에서 지운다
    this.redactor = (this.tool?.secrets ?? []).reduce(
      (r, secret) => r.with(secret),
      redactor.with(job.runToken).with(login.token),
    );
    this.reporter = new ProgressReporter(server, job.taskId, this.redactor, job.leaseUntil);
  }

  async perform(): Promise<void> {
    let workspace: JobWorkspace | null = null;
    try {
      const unfit = this.refusal();
      if (unfit) return await this.conclude(unfit);
      // 토큰이 없는 것은 일의 실패가 아니다. 돌려주고, 주인이 토큰을 넣으면 다시 맡는다
      if (this.tool === null) return await this.conclude(RunEnding.release(this.login.problem));
      workspace = await this.tool.open(this.job);
      const { skill } = this.job;
      if (skill && JobWorkspace.skillText(skill, this.config.skillsDir) === null)
        this.log.info(`스킬 ${skill}이 없어 지시만으로 해요`);
      await this.supervise(workspace, this.tool);
    } catch (error) {
      if (!(error instanceof CliUnavailable))
        await this.conclude(RunEnding.release(`러너 오류: ${(error as Error).message}`));
      throw error;
    } finally {
      await workspace?.remove();
    }
  }

  /** 시작도 하지 않고 끝낼 일 */
  private refusal(): RunEnding | null {
    if (this.stop.aborted) return RunEnding.release(JobRun.STOPPING);
    if (AiTools.SUPPORTED.includes(this.job.tool)) return null;
    const error = `${this.job.tool}는 아직 러너가 지원하지 않아요`;
    return RunEnding.submit(error, RunResult.failed(error, this.redactor));
  }

  private async supervise(workspace: JobWorkspace, tool: AiTool): Promise<void> {
    const stream = tool.stream();
    const wake = new AbortController();
    const child = tool.start(this.job, workspace, (line) => {
      this.reporter.add(stream.read(line));
      this.reporter.notePlan(stream.takePlanUsage());
      if (stream.breach !== null) wake.abort();
    });
    void child.exited.then(() => wake.abort());
    const decided = await this.watch(stream, wake.signal);
    if (decided) await child.kill();
    const exit = await child.exited;
    this.reporter.add(stream.finish());
    if (exit.spawnError !== null) {
      await this.conclude(RunEnding.release(`AI CLI를 실행하지 못했어요: ${exit.spawnError}`));
      throw new CliUnavailable(`AI CLI를 실행하지 못했어요 (${tool.bin})`);
    }
    await this.writeBack(tool, workspace);
    const ending = decided
      ? ((await this.flush()) ?? decided)
      : ((await this.flushForSubmit()) ?? this.fromExit(exit, stream, child));
    await this.conclude(ending);
  }

  /**
   * 끝낼 이유가 생기거나 AI CLI가 끝날 때까지 기록을 보낸다. 조용해도 빈 보고를 보내 임대를 늘리고 서버의 답을 듣는다.
   * wake는 AI CLI가 끝났거나 격리가 깨졌을 때 울린다. 스스로 끝났으면 null
   */
  private async watch(stream: AiStream, wake: AbortSignal): Promise<RunEnding | null> {
    const alarm = AbortSignal.any([wake, this.stop]);
    for (;;) {
      await pause(JobRun.REPORT_MS, alarm);
      if (stream.breach !== null) return this.breached(stream);
      if (this.stop.aborted) return RunEnding.release(JobRun.STOPPING);
      if (wake.aborted) return null;
      const ending = await this.reportOnce();
      if (ending) return ending;
    }
  }

  /** 다른 MCP 서버나 열린 셸이 보이면 격리가 깨진 것이다. 쓰기 전에 끈다 */
  private breached(stream: AiStream): RunEnding {
    const error = `격리가 깨져 멈췄어요. ${stream.breach}`;
    return RunEnding.submit(error, RunResult.failed(error, this.redactor));
  }

  private async reportOnce(): Promise<RunEnding | null> {
    try {
      return JobRun.decide(await this.reporter.send());
    } catch (error) {
      const ending = JobRun.endingOfFailure(error);
      if (ending) return ending;
      this.log.info(`기록을 보내지 못해 다시 보내요: ${(error as Error).message}`);
      return this.reporter.leaseOver ? RunEnding.quiet('임대가 끝났어요') : null;
    }
  }

  /** 끄고 난 뒤: 남은 기록을 한 번씩만 보낸다. 끝내는 길은 이미 정해졌고, 임대가 끝나면 서버가 정리한다 */
  private async flush(): Promise<RunEnding | null> {
    try {
      do {
        const ending = JobRun.decide(await this.reporter.send());
        if (ending && ending.releaseReason === null) return ending;
      } while (!this.reporter.idle);
      return null;
    } catch (error) {
      const ending = JobRun.endingOfFailure(error);
      if (!ending) this.log.info(`남은 기록을 보내지 못했어요: ${(error as Error).message}`);
      return ending;
    }
  }

  /** 제출 전: 기록을 끝까지 보내고 작업이 아직 내 것인지 본다. 끝나지 않은 상태로만 null */
  private async flushForSubmit(): Promise<RunEnding | null> {
    try {
      do {
        const state = await this.persist(() => this.reporter.send());
        if (state.cancelled || state.status !== ProgressState.RUNNING) return JobRun.decide(state);
      } while (!this.reporter.idle);
      return null;
    } catch (error) {
      return (
        JobRun.endingOfFailure(error) ??
        RunEnding.quiet(`서버에 닿지 못해 제출하지 못했어요: ${(error as Error).message}`)
      );
    }
  }

  /**
   * 실행하는 동안 CLI가 갱신한 자격(Codex auth.json)을 서버에 되돌려 쓴다. 끝내는 길(성공 · 실패 · 취소)과 상관없이:
   * 버리면 다음 실행이 이미 쓴 갱신 토큰을 내밀어 로그인이 깨진다. 이 컴퓨터의 로그인(판 없음)은 서버에 쓰지 않는다.
   * 판이 다르면(주인이 그사이 다시 로그인) 서버가 거절하고 새 로그인이 이긴다
   */
  private async writeBack(tool: AiTool, workspace: JobWorkspace): Promise<void> {
    const { version } = this.login;
    if (version === null) return;
    const credential = await tool.changedCredential(workspace);
    if (credential === null) return;
    try {
      await this.persist(() =>
        this.server.aiLoginRefresh(this.job.taskId, tool.id, version, credential),
      );
      this.log.info(`${this.job.taskId}: 갱신된 ${tool.id} 로그인을 서버에 저장했어요`);
    } catch (error) {
      this.log.info(
        `${this.job.taskId}: 갱신된 로그인을 저장하지 못했어요: ${(error as Error).message}`,
      );
    }
  }

  private fromExit(exit: ChildExit, stream: AiStream, child: AiProcess): RunEnding {
    if (exit.code === 0 && stream.failure === null)
      return RunEnding.submit('끝났어요', RunResult.done(stream.finalText, this.redactor));
    const how = exit.signal ? `신호 ${exit.signal}` : `코드 ${exit.code}`;
    const why = stream.failure || child.stderrTail;
    const error = why ? `AI CLI가 ${how}로 끝났어요: ${why}` : `AI CLI가 ${how}로 끝났어요`;
    return RunEnding.submit(error, RunResult.failed(error, this.redactor));
  }

  private async conclude(ending: RunEnding): Promise<void> {
    this.log.info(this.redactor.clean(`${this.job.taskId}: ${ending.note}`));
    const { releaseReason, result } = ending;
    try {
      if (releaseReason !== null)
        await this.persist(() => this.server.release(this.job.taskId, releaseReason));
      if (result !== null) await this.persist(() => this.server.submit(this.job.taskId, result));
    } catch (error) {
      this.log.info(`${this.job.taskId}: 끝을 알리지 못했어요: ${(error as Error).message}`);
    }
  }

  /** 닿지 못하면 임대가 살아 있는 동안 같은 요청을 다시 보낸다. 임대가 끝나면 서버가 어차피 거절한다 */
  private async persist<T>(send: () => Promise<T>): Promise<T> {
    const backoff = new Backoff(JobRun.RETRY_FIRST_MS, JobRun.RETRY_MAX_MS);
    let stopBy: number | null = null;
    for (;;) {
      try {
        return await send();
      } catch (error) {
        if (this.stop.aborted) stopBy ??= Date.now() + JobRun.STOP_RETRY_MS;
        const outOfTime = stopBy !== null && Date.now() >= stopBy;
        if (!(error instanceof ServerUnreachable) || this.reporter.leaseOver || outOfTime)
          throw error;
        this.log.info(`다시 보내요: ${error.message}`);
        await backoff.wait();
      }
    }
  }

  /** 서버의 답으로 끝낼지 정한다. 계속해도 되면 null */
  private static decide(state: ProgressState): RunEnding | null {
    if (state.cancelled) return RunEnding.quiet('주인이 취소했어요');
    if (state.status === ProgressState.WAITING)
      return RunEnding.quiet('결재나 하위 작업을 기다려요');
    if (state.status !== ProgressState.RUNNING)
      return RunEnding.quiet(`이미 ${state.status} 상태예요`);
    return state.paused ? RunEnding.release(JobRun.PAUSED) : null;
  }

  /** 다시 보내도 소용없는 실패면 그만둔다. 일은 이미 이 러너의 것이 아니다 */
  private static endingOfFailure(error: unknown): RunEnding | null {
    if (error instanceof ToolRefused || error instanceof AccessDenied)
      return RunEnding.quiet(`서버가 거절했어요: ${error.message}`);
    if (error instanceof ServerUnreachable) return null;
    throw error;
  }
}
