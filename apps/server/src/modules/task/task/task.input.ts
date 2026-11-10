import { BaseRequest, type RequestFields } from '../../platform';
import type { PlanUsageRow, TaskNew } from '../task.tables';
import { PlanUsage } from '../usage/plan-usage';

// 작업 입력의 모양. REST(콘솔)는 camelCase, MCP(러너)는 다른 도구처럼 snake_case로 받는다.

const VERSION_MAX = 2_147_483_647;
const PRIORITY_MAX = 1000;

/**
 * 작업 하나를 만드는 입력. 콘솔(POST /api/tasks)은 requestId · instruction · agentId? · goalId?만 보내고,
 * 일 요청 이벤트(task.task.requested)는 종류, 제목, 대상까지 적는다.
 * 만들 때만 받는 칸이라 하나씩 읽는다 (제목은 지시에서 정하고, 빠지면 기본값이 들어간다).
 */
export class CreateTaskInput extends BaseRequest {
  private static readonly GENERAL = 'general';
  private static readonly TITLE_MAX = 200;

  private constructor(
    readonly requestId: string,
    /** goal_id: 이 작업이 향하는 목표 (진행 중이어야 한다) */
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
        base_version: f.optionalInteger('baseVersion', 0, VERSION_MAX),
        priority: f.optionalInteger('priority', -PRIORITY_MAX, PRIORITY_MAX) ?? 0,
        goal_id: CreateTaskInput.optionalUuid(f, raw, 'goalId'),
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

/** GET /api/tasks: ?status= · ?goalId= · ?cursor= */
export class ListTasksInput extends BaseRequest {
  private constructor(
    readonly status: string | null,
    /** 이 목표에 이어진 작업만 */
    readonly goalId: string | null,
    /** 앞 응답의 next */
    readonly cursor: string | null,
  ) {
    super();
  }

  static from(raw: unknown): ListTasksInput {
    const query = raw as Record<string, unknown>;
    return BaseRequest.read(
      raw,
      (f) =>
        new ListTasksInput(
          f.optionalText('status', 20),
          query.goalId ? f.uuid('goalId') : null,
          query.cursor ? f.uuid('cursor') : null,
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

/** next_jobs */
export class NextJobsInput extends BaseRequest {
  static readonly WAIT_MAX = 25;
  static readonly LIMIT_MAX = 10;

  static readonly TOOLS_MAX = 10;
  static readonly BUILD_MAX = 80;

  private constructor(
    readonly waitSeconds: number,
    readonly limit: number,
    /** 실행할 수 있는 AI CLI. null이면 거르지 않는다 (알리기 전의 러너) */
    readonly tools: readonly string[] | null,
    /** 웹 로그인을 대신 돌릴 수 있는 CLI. null이면 거르지 않는다 */
    readonly signinTools: readonly string[] | null,
    /** 러너가 스스로 가진 로그인 (주인 컴퓨터의 환경 변수 등) */
    readonly ownLogins: readonly string[],
    /** 서버 브라우저에 붙어 있는가. 알리지 않으면 false: 브라우저 작업은 알린 러너에게만 */
    readonly browser: boolean,
    /** 러너의 빌드 (지시문 틀의 판). 실행 기록에 남긴다 */
    readonly runnerBuild: string | null,
    /** 도구마다 CLI 버전 (claude → "2.1.302 (Claude Code)"). 실행 기록에 남긴다 */
    readonly cliVersions: ReadonlyMap<string, string>,
  ) {
    super();
  }

  static from(raw: unknown): NextJobsInput {
    const told = (raw as { browser?: unknown } | null | undefined)?.browser !== undefined;
    return BaseRequest.read(
      raw,
      (f) =>
        new NextJobsInput(
          f.optionalInteger('wait_seconds', 0, NextJobsInput.WAIT_MAX) ?? 0,
          f.optionalInteger('limit', 1, NextJobsInput.LIMIT_MAX) ?? 1,
          f.optionalTextList('tools', NextJobsInput.TOOLS_MAX, 40),
          f.optionalTextList('signin_tools', NextJobsInput.TOOLS_MAX, 40),
          f.optionalTextList('own_logins', NextJobsInput.TOOLS_MAX, 40) ?? [],
          told ? f.boolean('browser') : false,
          f.optionalText('runner_build', NextJobsInput.BUILD_MAX),
          f.textMap('cli_versions', NextJobsInput.BUILD_MAX),
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
      f.optionalInteger('tokens', 0, VERSION_MAX) ?? 0,
    );
  }
}

/** report_progress의 구독 사용률 창 하나. 어느 창을 저장할지는 도메인이 정한다 (PlanUsage) */
export class ReportedPlanUsage extends BaseRequest {
  private constructor(
    /** period는 API의 window다 (Postgres 예약어라 칸 이름이 다르다) */
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
  static readonly MODEL_MAX = 120;

  private constructor(
    readonly taskId: string,
    readonly requestId: string | null,
    readonly events: readonly ReportedEvent[],
    readonly planUsage: readonly ReportedPlanUsage[],
    /** AI CLI가 알린 모델. 이 실행의 기록에 한 번 남긴다 */
    readonly model: string | null,
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
          f.optionalText('model', ReportProgressInput.MODEL_MAX),
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

/** delegate_task의 하위 작업 하나. 받는 에이전트와 일의 뜻(종류, 권한)은 Task.subtask가 검사한다 */
export class SubtaskOrder extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly toAgentId: string,
    /** MCP 입력은 칸 이름 그대로다. 대상의 판(base_version)만 target_version으로 받는다 */
    readonly fields: Omit<TaskNew, 'id' | 'space_id'>,
  ) {
    super();
  }

  static from(f: RequestFields): SubtaskOrder {
    const targetKind = f.optionalText('target_kind', 40);
    return new SubtaskOrder(f.text('request_id', 200), f.uuid('to_agent_id'), {
      kind: f.optionalText('kind', 100) ?? 'general',
      title: f.text('title', 200),
      instruction: f.text('instruction', 20_000),
      target_kind: targetKind,
      target_id: targetKind === null ? null : f.uuid('target_id'),
      base_version:
        targetKind === null ? null : f.optionalInteger('target_version', 0, VERSION_MAX),
    });
  }
}

/**
 * delegate_task. 어느 작업 · 어느 에이전트인지는 작업 토큰에서 나온다.
 * 몇 개까지 맡길 수 있는지는 한도라 도메인(Task.assertCanDelegate)이 정하고, 여기서는 모양만 넉넉히 막는다.
 */
export class DelegateTaskInput extends BaseRequest {
  private static readonly SHAPE_MAX = 20;

  private constructor(readonly subtasks: readonly SubtaskOrder[]) {
    super();
  }

  static from(raw: unknown): DelegateTaskInput {
    return BaseRequest.read(
      raw,
      (f) =>
        new DelegateTaskInput(
          f.nestedList('subtasks', DelegateTaskInput.SHAPE_MAX).map((s) => SubtaskOrder.from(s)),
        ),
    );
  }
}
