import { writeFile } from 'node:fs/promises';
import type { AgentUser, StepOutput } from './agent-user';
import { CairnServer } from './cairn-server';
import { CodeRoom } from './code-room';
import { CodeSpec, CodeSpecProblem } from './code-spec';
import { GitRepo, PatchRejected, RepoRefused, RepoUnreachable } from './git-repo';
import { GitHubPulls, PullRefused } from './github-pulls';
import type { Job } from './job';
import { RunEnding } from './job-run';
import { McpClient, ServerUnreachable, ToolRefused } from './mcp-client';
import { RunEvent, RunResult } from './progress';
import type { Redactor, RunLog } from './redactor';
import type { RunnerConfig } from './runner-config';

// 코드 작업의 앞뒤 (docs/코드작업.md 3단계). JobRun이 AI 앞뒤에서 부르고, 그동안에도 보고 고리를 돌려 임대를 늘리고 취소를 듣는다.
//   앞: 저장소 정보 → 자리 → 깨끗한 clone(러너) → 사본을 agent에게 → setup(agent)
//   뒤: checks(agent) → 바뀐 것을 patch로(agent) → agent 프로세스 모두 끄기 → 깨끗한 clone에 옮기기(러너)
//       → 맡긴 경로 밖이면 실패 → 커밋 하나 → cairn/<작업>에 push(러너)
// 4단계 (code-github가 맡긴 일, repo.id가 있음): 앞에서 code_credential로 토큰을 받고("고쳐 달라"로 다시 온 일이면
// 이미 올린 브랜치에서 이어서), 뒤에서 push → draft PR(러너가 GitHub에) → code_pull_opened → 결과물 → 결재(code.pr.merge).
// 결재는 JobRun이 결과물을 올린 뒤 requestApproval로 올린다: 결재 대기가 되면 임대가 끝나 올릴 수 없다.
// 토큰은 러너의 메모리와 러너 git의 환경에만 있다 (AI는 다른 사용자라 읽지 못한다).
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
  static readonly MERGE_ACTION = 'code.pr.merge';
  static readonly PULL_TARGET = 'pull_request';

  private spec: CodeSpec | null = null;
  private room: CodeRoom | null = null;
  private repo: GitRepo | null = null;
  /** 저장소에 닿지 못해 돌려줬는가 (러너가 쉬었다 다시 빌린다) */
  private unreached = false;
  /** code-github의 저장소 토큰과 API 주소 (repo.id가 있는 일만) */
  private credential: { token: string; apiUrl: string } | null = null;
  /** PR을 열고 남긴 뒤 올릴 결재 */
  private approval: { pullId: string; version: number; note: string } | null = null;
  /** 토큰까지 지우는 Redactor (결과 · 기록에 토큰이 남지 않게) */
  private redactor: Redactor | null = null;

  constructor(
    private readonly job: Job,
    private readonly config: RunnerConfig,
    private readonly agent: AgentUser,
    private readonly log: RunLog,
    /** 기기 토큰으로 연 서버 (code_credential · code_pull_opened). 결재는 작업 토큰으로 따로 연다 */
    private readonly server: CairnServer | null = null,
  ) {}

  /** PR을 열어 결재를 올릴 차례인가 (JobRun이 결과물을 올린 뒤 requestApproval을 부른다) */
  get awaitsApproval(): boolean {
    return this.approval !== null;
  }

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
    this.redactor = redactor;
    // code-github가 맡긴 일: 토큰과 이미 연 PR. 받지 못하면 AI를 띄우지 않는다
    let continued = false;
    if (spec.repoId !== null) {
      const got = await this.credentialOf(signal);
      if (got instanceof RunEnding) return got;
      if (got === null) return null;
      this.credential = { token: got.token, apiUrl: got.apiUrl };
      this.redactor = redactor.with(got.token);
      continued = got.pull !== null && got.pull.branch === spec.branch;
    }
    const auth = this.credential?.token ?? null;
    const room = await CodeRoom.open(this.config.workDir, this.job.taskId, this.agent);
    this.room = room;
    const from = continued ? spec.branch : spec.base;
    note(new RunEvent(RunEvent.READ, `저장소를 받아요: ${spec.repoUrl} (${from})`, 0));
    try {
      this.repo = await this.cloneFrom(spec, room, auth, from, signal);
    } catch (error) {
      if (signal.aborted) return null;
      if (error instanceof RepoUnreachable) {
        this.unreached = true;
        return RunEnding.release(`저장소에 닿지 못해 돌려줘요: ${error.message}`);
      }
      if (error instanceof RepoRefused)
        return failed(`저장소를 받지 못했어요: ${this.clean(error.message)}`);
      throw error;
    }
    note(
      new RunEvent(
        RunEvent.RESULT,
        `저장소를 받았어요 (${from} ${this.repo.baseSha.slice(0, 7)})`,
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
    if (pushed !== null) return failed(this.clean(pushed));
    note(new RunEvent(RunEvent.WRITE, `${spec.branch}에 올렸어요 (${head.slice(0, 7)})`, 0));
    this.log.info(
      `${this.job.taskId}: ${spec.branch}에 올렸어요 (${head.slice(0, 7)}, 파일 ${files.length}개)`,
    );
    const report = CodeStage.report(spec, repo, head, files, checks, brief);
    if (this.credential === null)
      return RunEnding.submit('올렸어요', RunResult.done(report, redactor));
    // code-github: draft PR을 열고(있으면 본문만 고침) 남긴다. 결재는 결과물 뒤에 JobRun이 올린다
    const opened = await this.openPull(spec, head, checks, report, signal);
    if (typeof opened === 'string') return failed(this.clean(opened));
    note(new RunEvent(RunEvent.WRITE, `PR을 열었어요: ${opened.url}`, 0));
    return RunEnding.submit(
      'PR을 열었어요',
      RunResult.done(`${opened.url}\n\n${report}`, redactor),
    );
  }

  /**
   * PR의 머지 결재를 올린다 (작업 토큰으로: 에이전트의 이름이고 approval_actions에 code.pr.merge가 있어야 한다).
   * 올리면 null (작업은 결재 대기가 된다), 못 올리면 실패로 끝낼 그 끝
   */
  async requestApproval(signal: AbortSignal, redactor: Redactor): Promise<RunEnding | null> {
    const { approval } = this;
    if (approval === null || signal.aborted) return null;
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    if (!this.job.runToken) return failed('작업 토큰이 없어 결재를 올리지 못했어요');
    const asAgent = new CairnServer(new McpClient(this.config.mcpUrl, this.job.runToken));
    try {
      await asAgent.requestApproval({
        requestId: `code-merge:${this.job.taskId}:${approval.version}`,
        action: CodeStage.MERGE_ACTION,
        targetKind: CodeStage.PULL_TARGET,
        targetId: approval.pullId,
        targetVersion: approval.version,
        note: approval.note,
      });
      return null;
    } catch (error) {
      if (error instanceof ToolRefused)
        return failed(
          `PR을 열었지만 결재를 올리지 못했어요: ${error.message} (에이전트의 결재 동작에 ${CodeStage.MERGE_ACTION}가 있어야 해요)`,
        );
      return failed(`PR을 열었지만 결재를 올리지 못했어요: ${(error as Error).message}`);
    }
  }

  /** code_credential. 받지 못하면 그 끝(실패 · 돌려줌), 그만뒀으면 null */
  private async credentialOf(
    signal: AbortSignal,
  ): Promise<
    | { token: string; apiUrl: string; pull: { number: number; branch: string } | null }
    | RunEnding
    | null
  > {
    const failed = (error: string) =>
      RunEnding.submit(error, RunResult.failed(error, this.redactor as Redactor));
    if (this.server === null) return failed('저장소 토큰을 받을 서버 연결이 없어요');
    try {
      return await this.server.codeCredential(this.job.taskId, signal);
    } catch (error) {
      if (signal.aborted) return null;
      if (error instanceof ToolRefused)
        return failed(`저장소 토큰을 받지 못했어요: ${error.message}`);
      if (error instanceof ServerUnreachable)
        return RunEnding.release(`저장소 토큰을 받지 못해 돌려줘요: ${error.message}`);
      throw error;
    }
  }

  /** 이어서 할 브랜치가 지워졌으면(주인이 PR 브랜치를 지움) 기준 브랜치에서 새로 받는다 */
  private async cloneFrom(
    spec: CodeSpec,
    room: CodeRoom,
    auth: string | null,
    from: string,
    signal: AbortSignal,
  ): Promise<GitRepo> {
    try {
      return await GitRepo.clone(spec, room.cleanDir, room.gitHome, auth, signal, from);
    } catch (error) {
      if (from === spec.base || !(error instanceof RepoRefused) || signal.aborted) throw error;
      this.log.info(`${this.job.taskId}: ${from}가 없어 ${spec.base}에서 새로 받아요`);
      return GitRepo.clone(spec, room.cleanDir, room.gitHome, auth, signal, spec.base);
    }
  }

  /** draft PR을 열고 code_pull_opened로 남긴다. 결재에 쓸 판을 기억한다. 못 하면 이유 글 */
  private async openPull(
    spec: CodeSpec,
    head: string,
    checks: readonly { command: string; out: StepOutput }[],
    report: string,
    signal: AbortSignal,
  ): Promise<{ number: number; url: string } | string> {
    const credential = this.credential;
    if (credential === null || this.server === null) return 'PR을 열 자격이 없어요';
    let pull: { number: number; url: string };
    try {
      pull = await GitHubPulls.of(credential.apiUrl, credential.token, spec.repoUrl).ensure(
        spec.branch,
        spec.base,
        `cairn: ${this.job.title}`.slice(0, 120),
        `${report}\n\n---\nCairn 작업 ${this.job.taskId}가 연 PR이에요. 머지는 Cairn 결재 뒤에 해요.`,
        signal,
      );
    } catch (error) {
      if (error instanceof PullRefused)
        return `${spec.branch}에 올렸지만 PR을 열지 못했어요: ${error.message}`;
      return `${spec.branch}에 올렸지만 GitHub에 닿지 못해 PR을 열지 못했어요: ${(error as Error).message}`;
    }
    const results = checks.map((c) => ({ command: c.command, ok: c.out.ok }));
    try {
      const saved = await this.server.codePullOpened(this.job.taskId, {
        number: pull.number,
        url: pull.url,
        branch: spec.branch,
        headSha: head,
        checks: results,
      });
      const failedChecks = results.filter((c) => !c.ok).map((c) => c.command);
      this.approval = {
        pullId: saved.pullId,
        version: saved.version,
        note: [
          `PR: ${pull.url}`,
          results.length === 0
            ? '검사 명령 없음'
            : failedChecks.length === 0
              ? `검사 ${results.length}개 통과`
              : `실패한 검사: ${failedChecks.join(', ')}`,
          'GitHub에서 리뷰 · 머지한 뒤 승인해 주세요.',
        ].join('\n'),
      };
      return pull;
    } catch (error) {
      return `PR을 열었지만 Cairn에 남기지 못했어요 (${pull.url}): ${(error as Error).message}`;
    }
  }

  /** 토큰을 지운 글 */
  private clean(text: string): string {
    return this.redactor ? this.redactor.clean(text) : text;
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
        await repo.push(branch, this.credential?.token ?? null, signal);
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
