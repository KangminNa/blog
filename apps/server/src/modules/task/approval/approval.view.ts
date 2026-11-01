// 결재의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 결재 하나 */
export class ApprovalView {
  constructor(
    readonly id: string,
    readonly taskId: string | null,
    readonly agentId: string | null,
    readonly action: string,
    readonly targetKind: string,
    readonly targetId: string,
    readonly targetVersion: number,
    readonly status: string,
    readonly decidedBy: string | null,
    readonly decidedAt: Date | null,
    readonly note: string | null,
    readonly version: number,
    readonly createdAt: Date,
  ) {}

  toJSON() {
    return {
      id: this.id,
      taskId: this.taskId,
      agentId: this.agentId,
      action: this.action,
      target: { kind: this.targetKind, id: this.targetId, version: this.targetVersion },
      status: this.status,
      decidedBy: this.decidedBy,
      decidedAt: this.decidedAt?.toISOString() ?? null,
      note: this.note,
      version: this.version,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

/** 결재 목록 한 쪽 */
export class ApprovalPageView {
  constructor(
    readonly approvals: readonly ApprovalView[],
    readonly next: string | null,
  ) {}

  toJSON() {
    return { approvals: this.approvals.map((a) => a.toJSON()), next: this.next };
  }
}
