import type {
  AgentRow,
  GoalRow,
  OutputRow,
  TaskEventRow,
  TaskRow,
  TaskRunRow,
} from '../task.tables';

// 작업의 읽기 모양 (REST, 화면). 웹이 `import type`으로 가져온다 (객체설계 6장).
// 러너 · 에이전트가 MCP로 받는 모양(next_jobs · report_progress · delegate_task)은 job.view.ts.

/** 작업의 대상. 없으면 null */
function targetOf(r: Readonly<TaskRow>) {
  return r.target_kind === null
    ? null
    : { kind: r.target_kind, id: r.target_id, version: r.base_version };
}

/** 결과를 페이지로 내보내는 일(payload.page)이면 고칠 페이지. 새 페이지를 만드는 일은 pageId가 null */
function pageOf(r: Readonly<TaskRow>) {
  const page = (r.payload as { page?: { pageId?: string | null } } | null)?.page;
  return page ? { pageId: page.pageId ?? null } : null;
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
      /** 결과를 페이지로 내보내는 일이면 고칠 페이지 (새 페이지면 pageId가 null). 아니면 null */
      page: pageOf(r),
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
      prompt:
        r.prompt_source === null
          ? null
          : { source: r.prompt_source, revision: r.prompt_revision, hash: r.prompt_hash },
      runnerBuild: r.runner_build,
      cliVersion: r.cli_version,
      model: r.model,
    };
  }
}

/** 작업 상세의 결과물 한 줄 (휴지통 것은 빼고). 몇 번째 실행이 만들었는지까지 */
export class TaskOutputView {
  constructor(
    private readonly row: Readonly<OutputRow>,
    private readonly runSeq: number,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      runSeq: this.runSeq,
      createdAt: r.created_at.toISOString(),
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
    /** 이 작업이 만든 결과물 (올린 순서) */
    private readonly outputs: readonly TaskOutputView[] = [],
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
      outputs: this.outputs.map((o) => o.toJSON()),
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
