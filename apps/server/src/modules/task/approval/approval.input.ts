import { BaseRequest } from '../../platform';
import type { ApprovalRow } from '../task.tables';

// 결재 입력의 모양. REST(콘솔)는 camelCase, MCP(에이전트)는 다른 도구처럼 snake_case로 받는다.

const VERSION_MAX = 2_147_483_647;

/** request_approval. 요청자·작업은 작업 토큰에서 나온다. MCP 입력은 칸 이름 그대로다 */
export class RequestApprovalInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly fields: Pick<
      ApprovalRow,
      'action' | 'target_kind' | 'target_id' | 'target_version' | 'note'
    >,
  ) {
    super();
  }

  static from(raw: unknown): RequestApprovalInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new RequestApprovalInput(f.text('request_id', 200), {
          action: f.text('action', 100),
          target_kind: f.text('target_kind', 40),
          target_id: f.uuid('target_id'),
          target_version: f.integer('target_version', 0, VERSION_MAX),
          note: f.optionalText('note', 8000),
        }),
    );
  }
}

/** GET /api/approvals */
export class ListApprovalsInput extends BaseRequest {
  private constructor(
    readonly status: string | null,
    /** 앞 응답의 next */
    readonly cursor: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ListApprovalsInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ListApprovalsInput(
          f.optionalText('status', 20),
          (raw as Record<string, unknown>).cursor ? f.uuid('cursor') : null,
        ),
    );
  }
}

/** 결재 id */
export class ApprovalIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): ApprovalIdInput {
    return BaseRequest.read({ id }, (f) => new ApprovalIdInput(f.uuid('id')));
  }
}

/** POST /api/approvals/:id/decide { version, decision, note?, picked? }. picked는 결과 카드에서 고른 항목 id (비우면 모두) */
export class DecideApprovalInput extends BaseRequest {
  /** 카드 하나에 실리는 항목 수의 한도 */
  private static readonly PICK_MAX = 200;

  private constructor(
    readonly id: string,
    readonly version: number,
    readonly decision: string,
    readonly note: string | null,
    readonly picked: readonly string[] | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): DecideApprovalInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) =>
        new DecideApprovalInput(
          f.uuid('id'),
          f.version(),
          f.text('decision', 20),
          f.optionalText('note', 8000),
          f.optionalTextList('picked', DecideApprovalInput.PICK_MAX, 40),
        ),
    );
  }
}

/**
 * 결재한 동작의 실행 결과. 주제는 묻지 않는다: 어느 모듈의 이벤트든 내용에 `approvalId`와
 * `outcome`('done' · 'failed')을 실으면 결과다 (task는 blog를 모른다, 객체설계 9장).
 * 실패면 `error`에 이유를 적는다.
 */
export class ApprovalResultInput extends BaseRequest {
  private static readonly DONE = 'done';
  private static readonly FAILED = 'failed';

  private constructor(
    readonly approvalId: string,
    readonly succeeded: boolean,
    readonly error: string | null,
  ) {
    super();
  }

  /** 결과를 담은 이벤트인가 (task.approval.granted처럼 approvalId만 있는 것은 아니다) */
  static carriedBy(data: Readonly<Record<string, unknown>>): boolean {
    return (
      typeof data.approvalId === 'string' &&
      (data.outcome === ApprovalResultInput.DONE || data.outcome === ApprovalResultInput.FAILED)
    );
  }

  static from(data: Readonly<Record<string, unknown>>): ApprovalResultInput {
    return BaseRequest.read(
      data,
      (f) =>
        new ApprovalResultInput(
          f.uuid('approvalId'),
          data.outcome === ApprovalResultInput.DONE,
          f.optionalText('error', 4000),
        ),
    );
  }
}
