import type { ChangeOpRow, ChangeSetRow } from '../vault.tables';

// 변경 묶음의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다. AI에게 주는 답은 snake_case다.

/** 승인함의 한 줄을 읽는 칸: 변경 하나와 그 묶음의 칸 몇 개 */
export interface WaitingChangeRow
  extends ChangeOpRow,
    Pick<ChangeSetRow, 'kind' | 'message' | 'actor_type' | 'actor_id' | 'created_at'> {
  /** 묶음의 version. 결정할 때 보낸다 */
  set_version: number;
}

/** 승인함의 한 줄: 검토를 기다리는 변경 하나와 그 묶음의 정보. 결정할 때 setVersion을 보낸다 */
export class WaitingChangeView {
  constructor(private readonly row: Readonly<WaitingChangeRow>) {}

  toJSON() {
    const r = this.row;
    return {
      setId: r.change_set_id,
      seq: r.seq,
      op: r.op,
      target: { kind: r.target_kind, id: r.target_id, version: r.base_version },
      payload: r.payload,
      verdict: r.verdict,
      rule: r.rule,
      status: r.status,
      reason: r.reason,
      version: r.set_version,
      kind: r.kind,
      message: r.message,
      actorType: r.actor_type,
      actorId: r.actor_id,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 승인함 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class WaitingChangePageView {
  constructor(
    private readonly changes: readonly WaitingChangeView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { changes: this.changes.map((c) => c.toJSON()), next: this.next };
  }
}

/** 묶음 안의 변경 하나의 결과 */
export class ChangeOpView {
  constructor(private readonly row: Readonly<ChangeOpRow>) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      op: r.op,
      target: { kind: r.target_kind, id: r.target_id },
      verdict: r.verdict,
      rule: r.rule,
      status: r.status,
      reason: r.reason,
    };
  }
}

/** 변경 묶음 하나. 화면은 이 version으로 다음 결정을 보낸다 */
export class ChangeSetView {
  constructor(
    private readonly row: Readonly<ChangeSetRow>,
    private readonly ops: readonly Readonly<ChangeOpRow>[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      version: r.version,
      kind: r.kind,
      status: r.status,
      message: r.message,
      revertedBy: r.reverted_by,
      ops: this.ops.map((op) => new ChangeOpView(op).toJSON()),
    };
  }
}

/** submit_changes의 답 (AI에게): 변경마다 판정을 바로 알려 준다. 검토나 거부가 있어도 호출은 성공이다 */
export class SubmittedChangesView {
  constructor(
    private readonly setId: string,
    private readonly ops: readonly Readonly<ChangeOpRow>[],
  ) {}

  toJSON() {
    return {
      change_set_id: this.setId,
      ops: this.ops.map((op) => ({
        seq: op.seq,
        verdict: op.verdict,
        status: op.status,
        reason: op.reason,
      })),
    };
  }
}
