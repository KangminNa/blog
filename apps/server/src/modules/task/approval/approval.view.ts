import type { ApprovalRow } from '../task.tables';

// 결재의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 결재 하나. 읽기와 쓰기가 같은 모양이다 */
export class ApprovalView {
  constructor(private readonly row: Readonly<ApprovalRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      taskId: r.task_id,
      agentId: r.agent_id,
      action: r.action,
      target: { kind: r.target_kind, id: r.target_id, version: r.target_version },
      status: r.status,
      decidedBy: r.decided_by,
      decidedAt: r.decided_at?.toISOString() ?? null,
      note: r.note,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 결재 목록 한 쪽 */
export class ApprovalPageView {
  constructor(
    private readonly approvals: readonly ApprovalView[],
    /** 다음 쪽을 읽을 때 cursor로 보낸다. 마지막 쪽이면 null */
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { approvals: this.approvals.map((a) => a.toJSON()), next: this.next };
  }
}

/** request_approval의 답 (MCP라 snake_case). 작업은 결재를 기다리므로 에이전트는 여기서 멈춘다 */
export class ApprovalRequestedView {
  constructor(private readonly row: Readonly<ApprovalRow>) {}

  toJSON() {
    return { approval_id: this.row.id, status: this.row.status };
  }
}
