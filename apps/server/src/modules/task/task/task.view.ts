// 작업의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 작업 목록의 한 줄 */
export class TaskView {
  constructor(
    readonly id: string,
    readonly agentId: string | null,
    readonly kind: string,
    readonly title: string,
    readonly status: string,
    readonly priority: number,
    readonly targetKind: string | null,
    readonly targetId: string | null,
    readonly baseVersion: number | null,
    readonly attempts: number,
    readonly leaseUntil: Date | null,
    readonly version: number,
    readonly createdAt: Date,
    readonly finishedAt: Date | null,
    /** 마지막 실행 기록 앞부분. 목록에서만 채운다 */
    readonly lastEvent: string | null,
    /** 이 작업이 향하는 목표 */
    readonly goalId: string | null,
    /** 이 작업을 맡긴 위 작업 (위임). 주인이 맡긴 작업은 null */
    readonly parentId: string | null,
    /** waiting이면 무엇을 기다리는지: approval · subtasks */
    readonly waitReason: string | null,
  ) {}

  toJSON() {
    return {
      id: this.id,
      agentId: this.agentId,
      kind: this.kind,
      title: this.title,
      status: this.status,
      priority: this.priority,
      target:
        this.targetKind === null
          ? null
          : { kind: this.targetKind, id: this.targetId, version: this.baseVersion },
      attempts: this.attempts,
      leaseUntil: this.leaseUntil?.toISOString() ?? null,
      version: this.version,
      createdAt: this.createdAt.toISOString(),
      finishedAt: this.finishedAt?.toISOString() ?? null,
      lastEvent: this.lastEvent,
      goalId: this.goalId,
      parentId: this.parentId,
      waitReason: this.waitReason,
    };
  }
}

/** 실행 기록 한 줄 */
export class TaskEventView {
  constructor(
    readonly id: string,
    readonly at: Date,
    readonly kind: string,
    readonly body: string,
    readonly tokens: number,
  ) {}

  toJSON() {
    return {
      id: this.id,
      at: this.at.toISOString(),
      kind: this.kind,
      body: this.body,
      tokens: this.tokens,
    };
  }
}

/** 목표 사슬의 한 칸 */
export class TaskGoalView {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly status: string,
  ) {}

  toJSON() {
    return { id: this.id, title: this.title, status: this.status };
  }
}

/** 작업 하나: 목록 정보 + 지시, 입력, 결과, 실행 기록, 목표 사슬 */
export class TaskDetailView {
  constructor(
    readonly task: TaskView,
    readonly instruction: string,
    readonly payload: unknown,
    readonly result: unknown,
    readonly events: readonly TaskEventView[],
    /** 회사 목표부터 이 작업의 목표까지. 목표가 없으면 비어 있다 */
    readonly goalChain: readonly TaskGoalView[],
    /** 이 작업이 맡긴 하위 작업 (맡긴 순서) */
    readonly children: readonly TaskView[],
  ) {}

  toJSON() {
    return {
      ...this.task.toJSON(),
      instruction: this.instruction,
      payload: this.payload,
      result: this.result,
      events: this.events.map((e) => e.toJSON()),
      goalChain: this.goalChain.map((g) => g.toJSON()),
      children: this.children.map((c) => c.toJSON()),
    };
  }
}

/** 작업 목록 한 쪽 */
export class TaskPageView {
  constructor(
    readonly tasks: readonly TaskView[],
    readonly next: string | null,
  ) {}

  toJSON() {
    return { tasks: this.tasks.map((t) => t.toJSON()), next: this.next };
  }
}

/** next_jobs의 팀원 한 명: 이 에이전트가 일을 맡길 수 있는 바로 아래 팀원 */
export class JobTeamMemberView {
  constructor(
    readonly agentId: string,
    readonly name: string,
    readonly role: string,
    readonly status: string,
    /** 이 팀원에게 맡길 수 있는 일의 종류 */
    readonly kinds: readonly string[],
  ) {}

  toJSON() {
    return {
      agent_id: this.agentId,
      name: this.name,
      role: this.role,
      status: this.status,
      kinds: this.kinds,
    };
  }
}

/** next_jobs의 하위 작업 결과 하나. 깨어난 위 작업이 결과를 모을 때 */
export class JobSubtaskResultView {
  constructor(
    readonly taskId: string,
    readonly title: string,
    readonly agent: string | null,
    readonly status: string,
    /** 러너가 낸 결과 글의 앞부분 */
    readonly summary: string | null,
    readonly error: string | null,
  ) {}

  toJSON() {
    return {
      task_id: this.taskId,
      title: this.title,
      agent: this.agent,
      status: this.status,
      summary: this.summary,
      error: this.error,
    };
  }
}

/**
 * 러너가 빌려 간 일 하나 (next_jobs). MCP 도구의 모양이라 snake_case. run_token은 여기서 한 번만 나간다.
 * 연결 확인(task.kind가 ai_test)에는 에이전트도 run_token도 없다. 어느 도구인지는 task.payload.tool에 있다.
 */
export class JobView {
  constructor(
    readonly taskId: string,
    readonly kind: string,
    readonly title: string,
    readonly instruction: string,
    readonly payload: unknown,
    readonly targetKind: string | null,
    readonly targetId: string | null,
    readonly baseVersion: number | null,
    readonly skill: string | null,
    readonly revisionNote: string | null,
    readonly agentId: string | null,
    readonly agentName: string | null,
    readonly agentRole: string | null,
    readonly agentTool: string | null,
    readonly leaseUntil: Date | null,
    readonly runToken: string | null,
    /** 회사 목표부터 이 작업의 목표까지 (제목) */
    readonly goalChain: readonly string[],
    /** 바로 아래 팀. 팀이 없으면 비어 있다 */
    readonly team: readonly JobTeamMemberView[],
    /** 맡긴 하위 작업의 결과. 하위 작업이 끝나 깨어난 일에만 있다 */
    readonly subtaskResults: readonly JobSubtaskResultView[],
    /** 앞으로 위임할 수 있는 횟수 */
    readonly roundsLeft: number,
  ) {}

  toJSON() {
    return {
      task: {
        id: this.taskId,
        kind: this.kind,
        title: this.title,
        payload: this.payload,
        lease_until: this.leaseUntil?.toISOString() ?? null,
      },
      instruction: this.instruction,
      target:
        this.targetKind === null
          ? null
          : { kind: this.targetKind, id: this.targetId, version: this.baseVersion },
      skill: this.skill,
      revision_note: this.revisionNote,
      agent:
        this.agentId === null
          ? null
          : {
              id: this.agentId,
              name: this.agentName,
              role: this.agentRole,
              tool: this.agentTool,
            },
      run_token: this.runToken,
      goal_chain: this.goalChain.map((title) => ({ title })),
      team: this.team.map((m) => m.toJSON()),
      subtask_results: this.subtaskResults.map((r) => r.toJSON()),
      rounds_left: this.roundsLeft,
    };
  }
}

/** 진행 보고의 답 (report_progress). cancelled면 러너가 작업을 멈춘다 */
export class ProgressView {
  constructor(
    readonly status: string,
    readonly cancelled: boolean,
    /** 에이전트가 멈췄는가 (한도를 넘겼거나 주인이 멈춤). 러너는 release_job으로 돌려줄 수 있다 */
    readonly paused: boolean,
    readonly leaseUntil: Date | null,
  ) {}

  toJSON() {
    return {
      status: this.status,
      cancelled: this.cancelled,
      paused: this.paused,
      lease_until: this.leaseUntil?.toISOString() ?? null,
    };
  }
}
