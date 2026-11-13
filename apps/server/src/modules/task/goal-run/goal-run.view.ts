import type { GoalRoundRow, GoalRunRow } from '../task.tables';

// 목표 실행의 읽기 모양. 웹이 `import type`으로 가져온다. 주인만 본다.

/** 실행 하나 (만들기 · 멈추기의 답, 목록의 한 줄) */
export class GoalRunView {
  constructor(
    private readonly row: Readonly<GoalRunRow>,
    private readonly goalTitle: string | null = null,
    private readonly agentName: string | null = null,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      goalId: r.goal_id,
      goalTitle: this.goalTitle,
      agentId: r.agent_id,
      agentName: this.agentName,
      title: r.title,
      instruction: r.instruction,
      criteria: r.criteria,
      checkpoint: r.checkpoint,
      round: r.round,
      maxRounds: r.max_rounds,
      status: r.status,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      finishedAt: r.finished_at?.toISOString() ?? null,
    };
  }
}

/** 회차 보고 하나 (결재문의 본문) */
export class GoalRoundView {
  constructor(private readonly row: Readonly<GoalRoundRow>) {}

  toJSON() {
    const r = this.row;
    return {
      round: r.round,
      taskId: r.task_id,
      summary: r.summary,
      completed: r.completed,
      remaining: r.remaining,
      evidence: r.evidence as { url?: string; outputId?: string; note?: string }[],
      nextPlan: r.next_plan,
      done: r.done,
      milestone: r.milestone,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 실행 목록 (최근부터) */
export class GoalRunListView {
  constructor(private readonly runs: readonly GoalRunView[]) {}

  toJSON() {
    return { runs: this.runs.map((r) => r.toJSON()) };
  }
}

/** 실행 상세: 회차 보고 전부와 기다리는 결재 */
export class GoalRunDetailView {
  constructor(
    private readonly run: GoalRunView,
    private readonly rounds: readonly Readonly<GoalRoundRow>[],
    private readonly pendingApprovalId: string | null,
  ) {}

  toJSON() {
    return {
      ...this.run.toJSON(),
      rounds: this.rounds.map((r) => new GoalRoundView(r).toJSON()),
      pendingApprovalId: this.pendingApprovalId,
    };
  }
}
