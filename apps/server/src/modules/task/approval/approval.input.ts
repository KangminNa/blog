import { BaseRequest } from '../../platform';
import { INT_MAX } from '../task/task.input';
import type { ApprovalNew } from '../task.tables';

// 결재 입력의 모양. REST(콘솔)는 camelCase, MCP(에이전트)는 다른 도구처럼 snake_case로 받는다.

/** request_approval. 요청자·작업은 작업 토큰에서 나온다. MCP 입력은 칸 이름 그대로다 */
export class RequestApprovalInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly fields: Omit<ApprovalNew, 'id' | 'space_id'>,
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
          target_version: f.integer('target_version', 0, INT_MAX),
          note: f.optionalText('note', 8000),
        }),
    );
  }
}

/** POST /api/approvals/:id/decide { version, decision, note? } */
export class DecideApprovalInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly decision: string,
    readonly note: string | null,
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
