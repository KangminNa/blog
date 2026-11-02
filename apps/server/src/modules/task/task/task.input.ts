import { BaseRequest, type RequestFields } from '../../platform';
import type { PlanUsageRow, TaskNew } from '../task.tables';
import { PlanUsage } from '../usage/plan-usage';

// 작업 입력의 모양. REST(콘솔)는 camelCase, MCP(러너)는 다른 도구처럼 snake_case로 받는다.

/** 표의 int 칸에 들어가는 가장 큰 값. 0도 받는 칸(판 번호, 토큰)이라 f.version()으로 읽지 않는다 */
export const INT_MAX = 2_147_483_647;
const PRIORITY_MAX = 1000;

/**
 * 작업 하나를 만드는 입력. 콘솔(POST /api/tasks)은 requestId · instruction · agentId?만 보내고,
 * 일 요청 이벤트(task.task.requested)는 종류, 제목, 대상까지 적는다.
 * 칸마다 없을 때의 값이 달라서(제목은 지시의 첫 줄, id는 null, 나머지는 기본값) f.columns로 읽지 않고 한 칸씩 적는다.
 */
export class CreateTaskInput extends BaseRequest {
  private static readonly GENERAL = 'general';
  private static readonly TITLE_MAX = 200;

  private constructor(
    readonly requestId: string,
    readonly fields: Omit<TaskNew, 'id' | 'space_id'>,
  ) {
    super();
  }

  static from(raw: unknown): CreateTaskInput {
    return BaseRequest.read(raw, (f) => {
      const instruction = f.optionalText('instruction', 20_000) ?? '';
      return new CreateTaskInput(f.text('requestId', 200), {
        agent_id: CreateTaskInput.optionalUuid(f, raw, 'agentId'),
        kind: f.optionalText('kind', 100) ?? CreateTaskInput.GENERAL,
        title: CreateTaskInput.titleOf(f, instruction),
        instruction,
        payload: f.optionalRecord('payload'),
        target_kind: f.optionalText('targetKind', 40),
        target_id: CreateTaskInput.optionalUuid(f, raw, 'targetId'),
        base_version: f.optionalInteger('baseVersion', 0, INT_MAX),
        priority: f.optionalInteger('priority', -PRIORITY_MAX, PRIORITY_MAX) ?? 0,
      });
    });
  }

  /** 제목이 없으면 지시의 첫 줄. 둘 다 없으면 시킬 일이 없다 */
  private static titleOf(f: RequestFields, instruction: string): string {
    const firstLine = instruction
      .split('\n')
      .find((line) => line.trim())
      ?.trim();
    return (
      f.optionalText('title', CreateTaskInput.TITLE_MAX) ??
      firstLine?.slice(0, CreateTaskInput.TITLE_MAX) ??
      f.text('title', CreateTaskInput.TITLE_MAX)
    );
  }

  private static optionalUuid(f: RequestFields, raw: unknown, name: string): string | null {
    const value = (raw as Record<string, unknown> | null | undefined)?.[name];
    return value === undefined || value === null ? null : f.uuid(name);
  }
}

/** 상태로 거르는 목록 (GET /api/tasks, GET /api/approvals) */
export class ListInput extends BaseRequest {
  private constructor(
    readonly status: string | null,
    /** 앞 응답의 next */
    readonly cursor: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ListInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ListInput(
          f.optionalText('status', 20),
          (raw as Record<string, unknown>).cursor ? f.uuid('cursor') : null,
        ),
    );
  }
}

/** 주소의 id 하나 (작업, 결재) */
export class IdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): IdInput {
    return BaseRequest.read({ id }, (f) => new IdInput(f.uuid('id')));
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
          f.optionalInteger('wait_seconds', 0, NextJobsInput.WAIT_MAX) ?? 0,
          f.optionalInteger('limit', 1, NextJobsInput.LIMIT_MAX) ?? 1,
        ),
    );
  }
}

/** report_progress의 기록 한 줄 */
export class ReportedEvent extends BaseRequest {
  private constructor(
    readonly kind: string,
    readonly body: string,
    readonly tokens: number,
  ) {
    super();
  }

  static from(f: RequestFields): ReportedEvent {
    return new ReportedEvent(
      f.text('kind', 20),
      f.optionalText('body', 20_000) ?? '',
      f.optionalInteger('tokens', 0, INT_MAX) ?? 0,
    );
  }
}

/** report_progress의 구독 사용률 창 하나. 어느 창을 저장할지는 도메인이 정한다 (PlanUsage) */
export class ReportedPlanUsage extends BaseRequest {
  private constructor(
    readonly fields: Pick<PlanUsageRow, 'period' | 'percent' | 'resets_at' | 'status'>,
  ) {
    super();
  }

  static from(f: RequestFields): ReportedPlanUsage {
    const resetsAt = f.optionalDate('resets_at');
    if (resetsAt === null) f.reject('resets_at', 'ISO 8601 날짜여야 해요');
    return new ReportedPlanUsage({
      period: f.text('window', 40),
      percent: f.integer('percent', 0, PlanUsage.PERCENT_MAX),
      resets_at: resetsAt ?? new Date(0),
      status: f.optionalText('status', 40),
    });
  }
}

/**
 * report_progress. 기록을 모아 보내고, 남길 기록이 없으면 events를 비워 임대만 늘린다.
 * request_id를 주면 같은 보고가 두 번 와도 토큰을 두 번 세지 않는다.
 * plan_usage는 러너가 본 구독 사용률이다. 없어도 된다.
 */
export class ReportProgressInput extends BaseRequest {
  static readonly EVENTS_MAX = 100;
  static readonly PLAN_USAGE_MAX = 10;

  private constructor(
    readonly taskId: string,
    readonly requestId: string | null,
    readonly events: readonly ReportedEvent[],
    readonly planUsage: readonly ReportedPlanUsage[],
  ) {
    super();
  }

  get tokens(): number {
    return this.events.reduce((sum, e) => sum + e.tokens, 0);
  }

  static from(raw: unknown): ReportProgressInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new ReportProgressInput(
          f.uuid('task_id'),
          f.optionalText('request_id', 200),
          f.nestedList('events', ReportProgressInput.EVENTS_MAX).map((e) => ReportedEvent.from(e)),
          ReportProgressInput.planUsageOf(raw, f),
        ),
    );
  }

  private static planUsageOf(raw: unknown, f: RequestFields): readonly ReportedPlanUsage[] {
    const value = (raw as Record<string, unknown> | null | undefined)?.plan_usage;
    if (value === undefined || value === null) return [];
    return f
      .nestedList('plan_usage', ReportProgressInput.PLAN_USAGE_MAX)
      .map((p) => ReportedPlanUsage.from(p));
  }
}

/** submit_result. status는 done · failed, 실패면 error에 이유를 적는다 */
export class SubmitResultInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly requestId: string,
    readonly status: string,
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
          f.text('status', 20),
          f.optionalRecord('result'),
          f.optionalText('error', 4000),
        ),
    );
  }
}

/** release_job. 왜 돌려주는지는 실행 기록에 남는다 */
export class ReleaseJobInput extends BaseRequest {
  private constructor(
    readonly taskId: string,
    readonly reason: string,
  ) {
    super();
  }

  static from(raw: unknown): ReleaseJobInput {
    return BaseRequest.read(
      raw,
      (f) => new ReleaseJobInput(f.uuid('task_id'), f.text('reason', 1000)),
    );
  }
}
