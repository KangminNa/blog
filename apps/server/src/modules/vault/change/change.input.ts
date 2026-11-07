import { BaseRequest, type RequestFields } from '../../platform';
import { type ChangeOp, ChangeOps } from './change-op';

// 변경 묶음 입력의 모양. REST(콘솔)는 camelCase, MCP(AI)는 snake_case로 받는다.
// 도구 모양은 docs/API설계.md 4장이 원본이고, payload의 칸은 변경 종류마다 다르다 (SubmitChangesTool의 설명).

const VERSION_MAX = 2_147_483_647;
const SEQ_MAX = 9_999;

/** submit_changes */
export class SubmitChangesInput extends BaseRequest {
  static readonly OPS_MAX = 500;

  private constructor(
    readonly requestId: string,
    readonly message: string,
    readonly ops: readonly ChangeOp[],
  ) {
    super();
  }

  static from(raw: unknown): SubmitChangesInput {
    return BaseRequest.read(raw, (f) => {
      const items = f.nestedList('ops', SubmitChangesInput.OPS_MAX);
      if (Array.isArray((raw as Record<string, unknown>)?.ops) && items.length === 0)
        f.reject('ops', '변경을 하나 이상 보내 주세요');
      const ops = items.map((item, i) => SubmitChangesInput.op(item, i + 1));
      return new SubmitChangesInput(
        f.text('request_id', 200),
        f.text('message', 2000),
        ops.filter((op) => op !== null),
      );
    });
  }

  private static op(item: RequestFields, seq: number): ChangeOp | null {
    const name = item.text('op', 40);
    if (name && !ChangeOps.FOR_AI.includes(name))
      item.reject('op', `${ChangeOps.FOR_AI.join(' · ')} 중 하나여야 해요`);
    const target = item.optionalText('target_id', 36);
    const targetId = target === null ? null : item.uuid('target_id');
    const baseVersion = item.optionalInteger('base_version', 1, VERSION_MAX);
    return ChangeOps.read(name, seq, targetId, baseVersion, item.nested('payload'), item);
  }
}

/** 관리 화면 편집 한 번 (ChangeService.edit). 변경은 규칙을 거치지 않고 바로 합쳐진다 */
export class EditInput extends BaseRequest {
  constructor(
    /** 새로 만들 때 같은 요청이 다시 오면 처음 결과를 돌려준다 */
    readonly requestId: string | null,
    readonly message: string,
    readonly ops: readonly ChangeOp[],
  ) {
    super();
  }
}

/** GET /api/changes?status=waiting&cursor= */
export class ListChangesInput extends BaseRequest {
  private static readonly WAITING = 'waiting';
  private static readonly CURSOR = /^([0-9a-f-]{36})\|(\d{1,9})$/;

  private constructor(
    /** 이 자리(묶음 id, 변경 번호) 뒤부터 */
    readonly after: readonly [string, number] | null,
  ) {
    super();
  }

  static from(query: unknown): ListChangesInput {
    return BaseRequest.read(query, (f) => {
      const status = f.optionalText('status', 20) ?? ListChangesInput.WAITING;
      if (status !== ListChangesInput.WAITING) f.reject('status', '지금은 waiting만 볼 수 있어요');
      const cursor = f.optionalText('cursor', 200);
      const decoded = cursor ? Buffer.from(cursor, 'base64url').toString() : '';
      const match = ListChangesInput.CURSOR.exec(decoded);
      if (cursor && !match) f.reject('cursor', '앞 응답의 next 값을 그대로 보내 주세요');
      return new ListChangesInput(match?.[1] && match[2] ? [match[1], Number(match[2])] : null);
    });
  }

  /** 다음 쪽을 부를 값: 이 쪽의 마지막 변경 */
  static cursorAfter(setId: string, seq: number): string {
    return Buffer.from(`${setId}|${seq}`).toString('base64url');
  }
}

/** POST /api/changes/:id/ops/:seq/decide { version, decision } */
export class DecideChangeInput extends BaseRequest {
  static readonly APPROVE = 'approve';
  static readonly DECLINE = 'decline';

  private constructor(
    readonly setId: string,
    readonly seq: number,
    readonly version: number,
    readonly decision: string,
  ) {
    super();
  }

  static from(setId: string, seq: string, raw: unknown): DecideChangeInput {
    return BaseRequest.read({ ...(raw as object), setId, seq: Number(seq) }, (f) => {
      const decision = f.text('decision', 20);
      if (decision && ![DecideChangeInput.APPROVE, DecideChangeInput.DECLINE].includes(decision))
        f.reject('decision', 'approve나 decline이어야 해요');
      return new DecideChangeInput(
        f.uuid('setId'),
        f.integer('seq', 1, SEQ_MAX),
        f.version(),
        decision,
      );
    });
  }

  get approved(): boolean {
    return this.decision === DecideChangeInput.APPROVE;
  }
}

/** POST /api/changes/:id/revert { version } */
export class RevertChangeInput extends BaseRequest {
  private constructor(
    readonly setId: string,
    readonly version: number,
  ) {
    super();
  }

  static from(setId: string, raw: unknown): RevertChangeInput {
    return BaseRequest.read(
      { ...(raw as object), setId },
      (f) => new RevertChangeInput(f.uuid('setId'), f.version()),
    );
  }
}
