import { BaseRequest, type RequestFields } from '../../platform';
import { integerOr } from '../input-fields';

// 작업 입력의 모양. REST(콘솔)는 camelCase, MCP(러너)는 다른 도구처럼 snake_case로 받는다.

const VERSION_MAX = 2_147_483_647;
const PRIORITY_MAX = 1000;

/** 작업 하나를 만드는 입력. 콘솔(POST /api/tasks)과 일 요청 이벤트(task.task.requested)가 같다 */
export class CreateTaskInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly agentId: string | null,
    readonly kind: string,
    readonly title: string,
    readonly instruction: string,
    readonly payload: Readonly<Record<string, unknown>>,
    readonly targetKind: string | null,
    readonly targetId: string | null,
    readonly baseVersion: number | null,
    readonly priority: number,
  ) {
    super();
  }

  static from(raw: unknown): CreateTaskInput {
    return BaseRequest.read(raw, (f) => {
      const targetId = CreateTaskInput.optionalUuid(f, raw, 'targetId');
      return new CreateTaskInput(
        f.text('requestId', 200),
        CreateTaskInput.optionalUuid(f, raw, 'agentId'),
        f.text('kind', 100),
        f.text('title', 200),
        f.optionalText('instruction', 20_000) ?? '',
        f.optionalRecord('payload'),
        f.optionalText('targetKind', 40),
        targetId,
        integerOr(f, raw, 'baseVersion', 0, VERSION_MAX, null),
        integerOr(f, raw, 'priority', -PRIORITY_MAX, PRIORITY_MAX, 0),
      );
    });
  }

  private static optionalUuid(f: RequestFields, raw: unknown, name: string): string | null {
    const value = (raw as Record<string, unknown> | null | undefined)?.[name];
    return value === undefined || value === null ? null : f.uuid(name);
  }
}

/** GET /api/tasks */
export class ListTasksInput extends BaseRequest {
  private constructor(
    readonly status: string | null,
    /** 이전 쪽의 마지막 id */
    readonly after: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ListTasksInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ListTasksInput(
          f.optionalText('status', 20),
          (raw as Record<string, unknown>).after ? f.uuid('after') : null,
        ),
    );
  }
}

/** 작업 id */
export class TaskIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): TaskIdInput {
    return BaseRequest.read({ id }, (f) => new TaskIdInput(f.uuid('id')));
  }
}

/** POST /api/tasks/:id/cancel */
export class CancelTaskInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }

  static from(id: string, raw: unknown): CancelTaskInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new CancelTaskInput(f.uuid('id'), f.integer('version', 1, VERSION_MAX)),
    );
  }
}

/** next_jobs */
export class NextJobsInput extends BaseRequest {
  static readonly WAIT_MAX = 25;
  static readonly LIMIT_MAX = 10;

  private constructor(
    readonly waitSeconds: number,
    readonly limit: number,
  ) {
    super();
  }

  static from(raw: unknown): NextJobsInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new NextJobsInput(
          integerOr(f, raw, 'wait_seconds', 0, NextJobsInput.WAIT_MAX, 0),
          integerOr(f, raw, 'limit', 1, NextJobsInput.LIMIT_MAX, 1),
        ),
    );
  }
}

/** report_progress. request_id를 주면 같은 보고가 두 번 와도 토큰을 두 번 세지 않는다 */
export class ReportProgressInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly requestId: string | null,
    readonly kind: string,
    readonly body: string,
    readonly tokens: number,
  ) {
    super();
  }

  static from(raw: unknown): ReportProgressInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ReportProgressInput(
          f.uuid('task_id'),
          f.optionalText('request_id', 200),
          f.text('kind', 20),
          f.optionalText('body', 20_000) ?? '',
          integerOr(f, raw, 'tokens', 0, VERSION_MAX, 0),
        ),
    );
  }
}

/** submit_result. error가 있으면 실패로 끝낸다 */
export class SubmitResultInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly requestId: string,
    readonly result: Readonly<Record<string, unknown>>,
    readonly error: string | null,
  ) {
    super();
  }

  static from(raw: unknown): SubmitResultInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new SubmitResultInput(
          f.uuid('task_id'),
          f.text('request_id', 200),
          f.optionalRecord('result'),
          f.optionalText('error', 4000),
        ),
    );
  }
}

/** release_job */
export class ReleaseJobInput extends BaseRequest {
  private constructor(readonly taskId: string) {
    super();
  }

  static from(raw: unknown): ReleaseJobInput {
    return BaseRequest.read(raw, (f) => new ReleaseJobInput(f.uuid('task_id')));
  }
}
