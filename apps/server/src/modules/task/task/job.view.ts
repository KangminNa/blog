import type { AgentRow, OutputRow, TaskRow } from '../task.tables';

// 러너 · 에이전트가 MCP로 받는 작업의 모양 (next_jobs · report_progress · submit_result · delegate_task). 도구의 모양이라 snake_case.
// 화면이 받는 모양은 task.view.ts. view끼리는 서로 가져오지 않는다 (경계 검사: view는 표 인터페이스만)

/** 하위 작업이 만든 결과물 한 줄 (깨어난 위 작업에게 보인다) */
export type SubtaskOutputRow = Pick<OutputRow, 'id' | 'task_id' | 'name' | 'kind'>;

/** 작업의 대상. 없으면 null (task.view.ts와 같은 모양) */
function targetOf(r: Readonly<TaskRow>) {
  return r.target_kind === null
    ? null
    : { kind: r.target_kind, id: r.target_id, version: r.base_version };
}

/** next_jobs의 팀원 한 명: 이 에이전트가 일을 맡길 수 있는 바로 아래 팀원 */
export class JobTeamMemberView {
  constructor(
    private readonly row: Readonly<AgentRow>,
    /** 이 팀원에게 맡길 수 있는 일의 종류 */
    private readonly kinds: readonly string[],
  ) {}

  toJSON() {
    const r = this.row;
    // bound: 정해진 러너에서만 일한다 (관리자의 컴퓨터일 수 있어 그 컴퓨터의 폴더를 읽는 일은 이 팀원에게)
    const bound = Boolean(r.runner_id);
    return {
      agent_id: r.id,
      name: r.name,
      role: r.role,
      status: r.status,
      kinds: this.kinds,
      bound,
    };
  }
}

/** next_jobs의 하위 작업 결과 하나. 깨어난 위 작업이 결과를 모을 때 */
export class JobSubtaskResultView {
  /** 위 작업에게 보이는 결과 글의 길이 */
  private static readonly SUMMARY_MAX = 2000;

  constructor(
    private readonly row: Readonly<TaskRow>,
    /** 맡은 에이전트의 이름 */
    private readonly agent: string | null,
    /** 러너가 낸 결과 글 (앞부분만 내보낸다) */
    private readonly summary: string | null,
    private readonly error: string | null,
  ) {}

  get taskId(): string {
    return this.row.id;
  }

  toJSON() {
    const r = this.row;
    return {
      task_id: r.id,
      title: r.title,
      agent: this.agent,
      status: r.status,
      summary: this.summary?.slice(0, JobSubtaskResultView.SUMMARY_MAX) ?? null,
      error: this.error,
    };
  }
}

/**
 * 러너에게 실어 보내는 스킬 한 판 (next_jobs의 skill_package, 지시문 틀은 prompt_package). 러너는 디스크의 skills/ 대신 이것으로 깐다.
 * source: repo(서버 이미지의 저장소 판) · console(주인이 고친 판, revision은 그 판 번호)
 */
export class JobSkillView {
  constructor(
    readonly name: string,
    private readonly source: string,
    private readonly revision: number | null,
    private readonly hash: string,
    private readonly files: Readonly<Record<string, string>>,
  ) {}

  toJSON() {
    return {
      name: this.name,
      source: this.source,
      revision: this.revision,
      hash: this.hash,
      files: this.files,
    };
  }
}

/**
 * 러너가 빌려 간 일 하나 (next_jobs). MCP 도구의 모양이라 snake_case. run_token은 여기서 한 번만 나간다.
 * 연결 확인(task.kind가 ai_test)에는 에이전트도 run_token도 없다. 어느 도구인지는 task.payload.tool에 있다.
 */
export class JobView {
  constructor(
    private readonly row: Readonly<TaskRow>,
    private readonly skill: string | null,
    private readonly revisionNote: string | null,
    /** bound: 정해진 러너에 묶였다 (Agent.bound) */
    private readonly agent: Readonly<
      Pick<AgentRow, 'id' | 'name' | 'role' | 'tool'> & { bound: boolean }
    > | null,
    private readonly runToken: string | null,
    /** 회사 목표부터 이 작업의 목표까지 (제목) */
    private readonly goalChain: readonly string[],
    /** 바로 아래 팀. 팀이 없으면 비어 있다 */
    private readonly team: readonly JobTeamMemberView[],
    /** 맡긴 하위 작업의 결과. 하위 작업이 끝나 깨어난 일에만 있다 */
    private readonly subtaskResults: readonly JobSubtaskResultView[],
    /** 앞으로 위임할 수 있는 횟수 */
    private readonly roundsLeft: number,
    /** 스킬의 지금 판 (파일까지). 스킬이 없는 일이면 null */
    private readonly skillPackage: JobSkillView | null = null,
  ) {}

  /** 지시문 틀(러너 스킬 cairn-runner)의 지금 판. 에이전트 없는 일(연결 확인 · 웹 로그인)은 null */
  private promptPackage: JobSkillView | null = null;

  withPrompt(prompt: JobSkillView | null): this {
    this.promptPackage = prompt;
    return this;
  }

  /** 하위 작업마다 만든 결과물 (작업 id → 결과물). 깨어난 위 작업이 결재문의 근거(output_id)로 건다 */
  private made: ReadonlyMap<string, readonly SubtaskOutputRow[]> = new Map();

  withOutputs(made: ReadonlyMap<string, readonly SubtaskOutputRow[]>): this {
    this.made = made;
    return this;
  }

  toJSON() {
    const r = this.row;
    const a = this.agent;
    return {
      task: {
        id: r.id,
        kind: r.kind,
        title: r.title,
        payload: r.payload,
        lease_until: r.lease_until?.toISOString() ?? null,
      },
      instruction: r.instruction,
      target: targetOf(r),
      skill: this.skill,
      skill_package: this.skillPackage?.toJSON() ?? null,
      prompt_package: this.promptPackage?.toJSON() ?? null,
      revision_note: this.revisionNote,
      // bound: 이 러너에 묶인 에이전트 (묶인 일은 그 러너만 빌린다). 러너는 이때만 나눈 폴더를 연다
      agent:
        a === null ? null : { id: a.id, name: a.name, role: a.role, tool: a.tool, bound: a.bound },
      run_token: this.runToken,
      goal_chain: this.goalChain.map((title) => ({ title })),
      team: this.team.map((m) => m.toJSON()),
      subtask_results: this.subtaskResults.map((s) => ({
        ...s.toJSON(),
        outputs: (this.made.get(s.taskId) ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          kind: o.kind,
        })),
      })),
      rounds_left: this.roundsLeft,
    };
  }
}

/** next_jobs의 답 */
export class NextJobsView {
  constructor(private readonly jobs: readonly JobView[]) {}

  toJSON() {
    return { jobs: this.jobs.map((j) => j.toJSON()) };
  }
}

/** 진행 보고의 답 (report_progress). cancelled면 러너가 작업을 멈춘다 */
export class ProgressView {
  constructor(
    private readonly row: Readonly<TaskRow>,
    private readonly cancelled: boolean,
    /** 에이전트가 멈췄는가 (한도를 넘겼거나 주인이 멈춤). 러너는 release_job으로 돌려줄 수 있다 */
    private readonly paused: boolean,
  ) {}

  toJSON() {
    return {
      status: this.row.status,
      cancelled: this.cancelled,
      paused: this.paused,
      lease_until: this.row.lease_until?.toISOString() ?? null,
    };
  }
}

/** submit_result · release_job의 답 */
export class JobStateView {
  constructor(private readonly row: Readonly<TaskRow>) {}

  toJSON() {
    return { task_id: this.row.id, status: this.row.status };
  }
}

/** delegate_task의 답. 작업은 하위 작업을 기다리므로 에이전트는 여기서 멈춘다 */
export class DelegatedView {
  constructor(
    private readonly subtasks: readonly Readonly<TaskRow>[],
    /** 위 작업이 기다리는 것 (subtasks) */
    private readonly waiting: string,
  ) {}

  toJSON() {
    return {
      subtasks: this.subtasks.map((r) => ({
        task_id: r.id,
        to_agent_id: r.agent_id,
        title: r.title,
        status: r.status,
      })),
      waiting: this.waiting,
    };
  }
}
