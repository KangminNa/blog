// 변경 묶음의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 승인함의 한 줄: 검토를 기다리는 변경 하나와 그 묶음의 정보. 결정할 때 setVersion을 보낸다 */
export class WaitingChangeView {
  constructor(
    readonly setId: string,
    readonly seq: number,
    readonly op: string,
    readonly targetKind: string,
    readonly targetId: string | null,
    readonly baseVersion: number | null,
    readonly payload: unknown,
    readonly verdict: string | null,
    readonly rule: string | null,
    readonly status: string,
    readonly reason: string | null,
    readonly setVersion: number,
    readonly kind: string,
    readonly message: string,
    readonly actorType: string,
    readonly actorId: string | null,
    readonly createdAt: Date,
  ) {}

  toJSON() {
    return {
      setId: this.setId,
      seq: this.seq,
      op: this.op,
      target: { kind: this.targetKind, id: this.targetId, version: this.baseVersion },
      payload: this.payload,
      verdict: this.verdict,
      rule: this.rule,
      status: this.status,
      reason: this.reason,
      version: this.setVersion,
      kind: this.kind,
      message: this.message,
      actorType: this.actorType,
      actorId: this.actorId,
      createdAt: this.createdAt.toISOString(),
    };
  }
}

/** 승인함 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class WaitingChangePageView {
  constructor(
    readonly changes: readonly WaitingChangeView[],
    readonly next: string | null,
  ) {}

  toJSON() {
    return { changes: this.changes.map((c) => c.toJSON()), next: this.next };
  }
}

/** 묶음 안의 변경 하나의 결과 */
export class ChangeOpView {
  constructor(
    readonly seq: number,
    readonly op: string,
    readonly targetKind: string,
    readonly targetId: string | null,
    readonly verdict: string | null,
    readonly rule: string | null,
    readonly status: string,
    readonly reason: string | null,
  ) {}

  toJSON() {
    return {
      seq: this.seq,
      op: this.op,
      target: { kind: this.targetKind, id: this.targetId },
      verdict: this.verdict,
      rule: this.rule,
      status: this.status,
      reason: this.reason,
    };
  }
}

/** 변경 묶음 하나. 화면은 이 version으로 다음 결정을 보낸다 */
export class ChangeSetView {
  constructor(
    readonly id: string,
    readonly version: number,
    readonly kind: string,
    readonly status: string,
    readonly message: string,
    readonly revertedBy: string | null,
    readonly ops: readonly ChangeOpView[],
  ) {}

  toJSON() {
    return {
      id: this.id,
      version: this.version,
      kind: this.kind,
      status: this.status,
      message: this.message,
      revertedBy: this.revertedBy,
      ops: this.ops.map((op) => op.toJSON()),
    };
  }
}
