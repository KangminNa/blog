import type { AgentRow, GoalRow, TaskEventRow, TaskRow, TaskRunRow } from '../task.tables';

// 작업의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 작업의 대상. 없으면 null */
function targetOf(r: Readonly<TaskRow>) {
  return r.target_kind === null
    ? null
    : { kind: r.target_kind, id: r.target_id, version: r.base_version };
}

/** 작업 목록의 한 줄 */
export class TaskView {
  constructor(
    private readonly row: Readonly<TaskRow>,
    /** 마지막 실행 기록 앞부분. 목록에서만 채운다 */
    private readonly lastEvent: string | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      agentId: r.agent_id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      priority: r.priority,
      target: targetOf(r),
      attempts: r.attempts,
      leaseUntil: r.lease_until?.toISOString() ?? null,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      finishedAt: r.finished_at?.toISOString() ?? null,
      lastEvent: this.lastEvent,
      /** 이 작업이 향하는 목표 */
      goalId: r.goal_id,
      /** 이 작업을 맡긴 위 작업 (위임). 주인이 맡긴 작업은 null */
      parentId: r.parent_id,
      /** waiting이면 무엇을 기다리는지: approval · subtasks */
      waitReason: r.wait_reason,
    };
  }
}

/** 실행 기록 한 줄 */
export class TaskEventView {
  constructor(private readonly row: Readonly<TaskEventRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: String(r.id),
      at: r.at.toISOString(),
      kind: r.kind,
      body: r.body,
      tokens: r.tokens,
    };
  }
}

/** 목표 사슬의 한 칸 */
export class TaskGoalView {
  constructor(private readonly row: Readonly<Pick<GoalRow, 'id' | 'title' | 'status'>>) {}

  toJSON() {
    return { id: this.row.id, title: this.row.title, status: this.row.status };
  }
}

/** 작업 하나: 목록 정보 + 지시, 입력, 결과, 실행 기록, 목표 사슬 */
/**
 * 실행 한 번 (임대 하나): 어떤 규칙 판으로 돌았는지. 결과가 바뀌었을 때 무엇을 바꿔서인지 비교한다.
 * 스킬은 콘솔 판이면 판 번호, 저장소 판이면 해시로 가린다
 */
export class TaskRunView {
  constructor(private readonly row: Readonly<TaskRunRow>) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      startedAt: r.started_at.toISOString(),
      agentRevision: r.agent_revision,
      skill:
        r.skill === null
          ? null
          : {
              name: r.skill,
              source: r.skill_source,
              revision: r.skill_revision,
              hash: r.skill_hash,
            },
      runnerBuild: r.runner_build,
      cliVersion: r.cli_version,
      model: r.model,
    };
  }
}

export class TaskDetailView extends TaskView {
  constructor(
    private readonly detail: Readonly<TaskRow>,
    /** 상세에 보일 입력. 웹 로그인의 코드는 암호문이어도 뺀다 (Task.shownPayload) */
    private readonly payload: unknown,
    private readonly events: readonly TaskEventView[],
    /** 회사 목표부터 이 작업의 목표까지. 목표가 없으면 비어 있다 */
    private readonly goalChain: readonly TaskGoalView[],
    /** 이 작업이 맡긴 하위 작업 (맡긴 순서) */
    private readonly children: readonly TaskView[],
    /** 실행마다 규칙 판 (처음부터) */
    private readonly runs: readonly TaskRunView[] = [],
  ) {
    super(detail);
  }

  override toJSON() {
    return {
      ...super.toJSON(),
      instruction: this.detail.instruction,
      payload: this.payload,
      result: this.detail.result,
      events: this.events.map((e) => e.toJSON()),
      goalChain: this.goalChain.map((g) => g.toJSON()),
      children: this.children.map((c) => c.toJSON()),
      runs: this.runs.map((r) => r.toJSON()),
    };
  }
}

/** 작업 목록 한 쪽 */
export class TaskPageView {
  constructor(
    private readonly tasks: readonly TaskView[],
    /** 다음 쪽을 읽을 때 cursor로 보낸다. 마지막 쪽이면 null */
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { tasks: this.tasks.map((t) => t.toJSON()), next: this.next };
  }
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
    return { agent_id: r.id, name: r.name, role: r.role, status: r.status, kinds: this.kinds };
  }
}

/** next_jobs의 하위 작업 결과 하나. 깨어난 위 작업이 결과를 모을 때 */
export class JobSubtaskResultView {
  constructor(
    private readonly row: Readonly<TaskRow>,
    /** 맡은 에이전트의 이름 */
    private readonly agent: string | null,
    /** 러너가 낸 결과 글의 앞부분 */
    private readonly summary: string | null,
    private readonly error: string | null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      task_id: r.id,
      title: r.title,
      agent: this.agent,
      status: r.status,
      summary: this.summary,
      error: this.error,
    };
  }
}

/**
 * 러너에게 실어 보내는 스킬 한 판 (next_jobs의 skill_package). 러너는 디스크의 skills/ 대신 이것으로 깐다.
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
    private readonly agent: Readonly<Pick<AgentRow, 'id' | 'name' | 'role' | 'tool'>> | null,
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
      revision_note: this.revisionNote,
      agent: a === null ? null : { id: a.id, name: a.name, role: a.role, tool: a.tool },
      run_token: this.runToken,
      goal_chain: this.goalChain.map((title) => ({ title })),
      team: this.team.map((m) => m.toJSON()),
      subtask_results: this.subtaskResults.map((s) => s.toJSON()),
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
