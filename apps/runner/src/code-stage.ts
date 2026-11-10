import { writeFile } from 'node:fs/promises';
import type { AgentUser, StepOutput } from './agent-user';
import { CodeRoom } from './code-room';
import { CodeSpec, CodeSpecProblem } from './code-spec';
import { GitRepo, PatchRejected, RepoRefused, RepoUnreachable } from './git-repo';
import type { Job } from './job';
import { RunEnding } from './job-run';
import { RunEvent, RunResult } from './progress';
import type { Redactor, RunLog } from './redactor';
import type { RunnerConfig } from './runner-config';

// 코드 작업의 앞뒤 (docs/코드작업.md 3단계). JobRun이 AI 앞뒤에서 부르고, 그동안에도 보고 고리를 돌려 임대를 늘리고 취소를 듣는다.
//   앞: 저장소 정보 → 자리 → 깨끗한 clone(러너) → 사본을 agent에게 → setup(agent)
//   뒤: checks(agent) → 바뀐 것을 patch로(agent) → agent 프로세스 모두 끄기 → 깨끗한 clone에 옮기기(러너)
//       → 맡긴 경로 밖이면 실패 → 커밋 하나 → cairn/<작업>에 push(러너)
// 러너는 AI의 자리에서 아무것도 실행하지 않는다. AI의 변경은 agent 권한으로 만든 patch라는 데이터 하나로만 받는다:
// AI가 .git에 심은 훅 · 설정이 토큰을 가진 러너의 git에서 돌지 않게.
export class CodeStage {
  private static readonly SETUP_MS = 15 * 60_000;
  private static readonly CHECK_MS = 10 * 60_000;
  private static readonly PATCH_MS = 2 * 60_000;
  /** 한 번에 올리는 변경의 한도 */
  private static readonly PATCH_MAX = 20 * 1024 * 1024;
  /** 결과에 싣는 출력의 끝부분 */
  private static readonly TAIL_MAX = 2_000;
  private static readonly FILES_SHOWN = 30;
  private static readonly PUSH_TRIES = 3;
  private static readonly SUMMARY_MAX = 4_000;

  private spec: CodeSpec | null = null;
  private room: CodeRoom | null = null;
  private repo: GitRepo | null = null;
  /** 저장소에 닿지 못해 돌려줬는가 (러너가 쉬었다 다시 빌린다) */
  private unreached = false;

  constructor(
    private readonly job: Job,
    private readonly config: RunnerConfig,
    private readonly agent: AgentUser,
    private readonly log: RunLog,
  ) {}

  /** 저장소에 닿지 못해 일을 돌려줬는가 */
  get unreachable(): boolean {
    return this.unreached;
  }

  /** AI CLI의 자리를 만들 곳 (prepare 뒤) */
  get workspaceRoom(): CodeRoom | null {
    return this.room;
  }

  /** AI에게 줄 일: 저장소 · 고칠 곳 · 검사 단락을 더한다 */
  aiJob(): Job {
    return this.spec ? this.job.withBrief(this.spec.brief) : this.job;
  }

  /** AI 전에. 끝낼 이유가 생기면 그 끝, 아니면 null */
  async prepare(
    signal: AbortSignal,
    note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<RunEnding | null> {
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    let spec: CodeSpec;
    try {
      spec = CodeSpec.from(this.job.taskId, this.job.codePayload);
    } catch (error) {
      if (error instanceof CodeSpecProblem)
        return failed(`코드 작업의 저장소 정보가 틀려요: ${error.message}`);
      throw error;
    }
    this.spec = spec;
    const room = await CodeRoom.open(this.config.workDir, this.job.taskId, this.agent);
    this.room = room;
    note(new RunEvent(RunEvent.READ, `저장소를 받아요: ${spec.repoUrl} (${spec.base})`, 0));
    try {
      this.repo = await GitRepo.clone(spec, room.cleanDir, room.gitHome, null, signal);
    } catch (error) {
      if (signal.aborted) return null;
      if (error instanceof RepoUnreachable) {
        this.unreached = true;
        return RunEnding.release(`저장소에 닿지 못해 돌려줘요: ${error.message}`);
      }
      if (error instanceof RepoRefused) return failed(`저장소를 받지 못했어요: ${error.message}`);
      throw error;
    }
    note(
      new RunEvent(
        RunEvent.RESULT,
        `저장소를 받았어요 (${spec.base} ${this.repo.baseSha.slice(0, 7)})`,
        0,
      ),
    );
    await room.handOver();
    if (spec.setup === null) return null;
    note(new RunEvent(RunEvent.READ, `setup: ${spec.setup}`, 0));
    const out = await this.agent.run(spec.setup, {
      cwd: room.repoDir,
      env: room.env(),
      timeoutMs: CodeStage.SETUP_MS,
      signal,
    });
    if (out.aborted) return null;
    if (!out.ok) {
      note(new RunEvent(RunEvent.ERROR, `setup ${out.how}`, 0));
      return failed(`setup이 ${out.how}로 끝나 AI를 띄우지 않았어요\n${CodeStage.tail(out)}`);
    }
    note(new RunEvent(RunEvent.RESULT, 'setup 통과', 0));
    return null;
  }

  /** AI가 잘 끝난 뒤. AI의 마지막 답(요약)과 함께 결과를 만든다 */
  async finish(
    summary: string,
    signal: AbortSignal,
    note: (event: RunEvent) => void,
    redactor: Redactor,
  ): Promise<RunEnding> {
    const { spec, room, repo } = this;
    if (!spec || !room || !repo) throw new Error('준비하지 않은 코드 작업이에요');
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));

    const checks: { command: string; out: StepOutput }[] = [];
    for (const command of spec.checks) {
      note(new RunEvent(RunEvent.READ, `검사: ${command}`, 0));
      const out = await this.agent.run(command, {
        cwd: room.repoDir,
        env: room.env(),
        timeoutMs: CodeStage.CHECK_MS,
        signal,
      });
      if (out.aborted) return RunEnding.quiet('검사하다 그만뒀어요');
      note(
        new RunEvent(out.ok ? RunEvent.RESULT : RunEvent.ERROR, `검사 ${command}: ${out.how}`, 0),
      );
      checks.push({ command, out });
    }

    // 바뀐 것: agent 권한으로 사본에서 기준 커밋과의 차이를 patch 하나로 (러너는 AI의 .git에서 git을 돌리지 않는다)
    const patch = await this.patchOf(room, repo.baseSha, signal);
    if (signal.aborted) return RunEnding.quiet('바뀐 것을 모으다 그만뒀어요');
    if (typeof patch === 'string') return failed(patch);
    // 토큰을 쓰기 전에: AI가 띄워 둔 프로세스가 하나도 남지 않게
    await this.agent.killAll();
    await writeFile(room.patchFile, patch, { mode: 0o600 });
    let files: readonly string[];
    try {
      files = await repo.apply(room.patchFile, patch.length === 0);
    } catch (error) {
      if (error instanceof PatchRejected)
        return failed(`바뀐 것을 깨끗한 저장소에 옮기지 못해 올리지 않았어요: ${error.message}`);
      throw error;
    }
    const brief = summary.trim().slice(0, CodeStage.SUMMARY_MAX);
    if (files.length === 0)
      return RunEnding.submit(
        '바꾼 파일이 없어요',
        RunResult.done(['바꾼 파일이 없어 올리지 않았어요.', '', brief].join('\n'), redactor),
      );
    const outside = spec.outside(files);
    if (outside.length > 0)
      return failed(`맡긴 경로 밖을 고쳐서 올리지 않았어요: ${CodeStage.list(outside).join(', ')}`);

    const head = await repo.commit(
      [`cairn: ${this.job.title}`.slice(0, 72), '', brief || '(요약 없음)'].join('\n'),
      `${this.job.agentName || '에이전트'} (Cairn)`,
    );
    const pushed = await this.push(repo, spec.branch, signal);
    if (pushed !== null) return failed(pushed);
    note(new RunEvent(RunEvent.WRITE, `${spec.branch}에 올렸어요 (${head.slice(0, 7)})`, 0));
    this.log.info(
      `${this.job.taskId}: ${spec.branch}에 올렸어요 (${head.slice(0, 7)}, 파일 ${files.length}개)`,
    );
    return RunEnding.submit(
      '올렸어요',
      RunResult.done(CodeStage.report(spec, repo, head, files, checks, brief), redactor),
    );
  }

  /** 자리를 지운다 (agent 프로세스를 모두 끈 뒤). 실패해도 일의 끝은 바꾸지 않는다 */
  async close(): Promise<void> {
    try {
      await this.room?.close();
    } catch (error) {
      this.log.info(`${this.job.taskId}: 작업 자리를 지우지 못했어요: ${(error as Error).message}`);
    }
  }

  /** agent 권한으로 만든 patch. 실패면 그 이유 글 */
  private async patchOf(
    room: CodeRoom,
    base: string,
    signal: AbortSignal,
  ): Promise<Buffer | string> {
    const options = { cwd: room.repoDir, env: room.env(), timeoutMs: CodeStage.PATCH_MS, signal };
    const added = await this.agent.exec('git', ['add', '-A'], options);
    if (!added.ok) return `바뀐 것을 모으지 못했어요 (git add ${added.how}): ${added.tail}`;
    const diff = await this.agent.exec(
      'git',
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '--cached',
        '--binary',
        '--no-color',
        '--no-ext-diff',
        '--no-renames',
        base,
      ],
      { ...options, stdoutMax: CodeStage.PATCH_MAX },
    );
    if (diff.ok && diff.stdout === null)
      return `바뀐 것이 너무 커서 올리지 않았어요 (${CodeStage.PATCH_MAX / 1024 / 1024}MB 넘음)`;
    if (!diff.ok || diff.stdout === null)
      return `바뀐 것을 모으지 못했어요 (git diff ${diff.how}): ${diff.tail}`;
    return diff.stdout;
  }

  /** 잠깐 닿지 못하면 몇 번 더. 끝내 안 되면 그 이유 (AI의 일을 처음부터 다시 하지 않게 실패로 끝낸다) */
  private async push(repo: GitRepo, branch: string, signal: AbortSignal): Promise<string | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        await repo.push(branch, null, signal);
        return null;
      } catch (error) {
        const retry =
          error instanceof RepoUnreachable && attempt < CodeStage.PUSH_TRIES && !signal.aborted;
        if (!retry) return `${branch}에 올리지 못했어요: ${(error as Error).message}`;
        await new Promise((done) => setTimeout(done, 2_000 * attempt));
      }
    }
  }

  /** 결과 글 (4단계부터는 PR 본문 · 결재 메모의 재료) */
  private static report(
    spec: CodeSpec,
    repo: GitRepo,
    head: string,
    files: readonly string[],
    checks: readonly { command: string; out: StepOutput }[],
    summary: string,
  ): string {
    const lines = [
      `${spec.branch} 브랜치에 올렸어요 (${head.slice(0, 7)}, 파일 ${files.length}개)`,
      `기준: ${spec.base} (${repo.baseSha.slice(0, 7)})`,
      '',
      '바꾼 파일:',
      ...CodeStage.list(files).map((f) => `- ${f}`),
    ];
    if (checks.length > 0) {
      lines.push('', '검사:', ...checks.map((c) => `- ${c.command}: ${c.out.how}`));
      for (const failed of checks.filter((c) => !c.out.ok))
        lines.push('', `--- ${failed.command}의 끝부분 ---`, CodeStage.tail(failed.out));
    }
    lines.push('', '요약:', summary || '(요약 없음)');
    return lines.join('\n');
  }

  private static list(files: readonly string[]): readonly string[] {
    const shown = files.slice(0, CodeStage.FILES_SHOWN);
    const rest = files.length - shown.length;
    return rest > 0 ? [...shown, `외 ${rest}개`] : shown;
  }

  private static tail(out: StepOutput): string {
    return out.tail.slice(-CodeStage.TAIL_MAX) || '(출력 없음)';
  }
}
