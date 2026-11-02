import type { AgentRow, TaskEventRow, TaskRow } from '../task.tables';

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
    protected readonly row: Readonly<TaskRow>,
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

/** 작업 하나: 목록 정보 + 지시, 입력, 결과, 실행 기록 */
export class TaskDetailView extends TaskView {
  constructor(
    row: Readonly<TaskRow>,
    private readonly events: readonly TaskEventView[],
  ) {
    super(row);
  }

  override toJSON() {
    const r = this.row;
    return {
      ...super.toJSON(),
      instruction: r.instruction,
      payload: r.payload,
      result: r.result,
      events: this.events.map((e) => e.toJSON()),
    };
  }
}

/** 작업 목록 한 쪽 */
export class TaskPageView {
  constructor(
    private readonly tasks: readonly TaskView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { tasks: this.tasks.map((t) => t.toJSON()), next: this.next };
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
    private readonly agent: Pick<AgentRow, 'id' | 'name' | 'role' | 'tool'> | null,
    private readonly runToken: string | null,
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
      revision_note: this.revisionNote,
      agent: a === null ? null : { id: a.id, name: a.name, role: a.role, tool: a.tool },
      run_token: this.runToken,
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
    const r = this.row;
    return {
      status: r.status,
      cancelled: this.cancelled,
      paused: this.paused,
      lease_until: r.lease_until?.toISOString() ?? null,
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
