import { BaseRequest, type ColumnReaders } from '../../platform';
import type { GoalRow } from '../task.tables';
import { Goal } from './goal';

// 목표 입력의 모양. 뜻(빈 제목, 상태 이름, 깊이)은 Goal이 검사한다.

const SORT_MAX = 1_000_000;

/** 주인이 정하는 칸. 칸 하나에 한 줄이다. 보내지 않은 칸은 그대로 */
const COLUMNS: ColumnReaders<GoalRow> = {
  title: (f, n) => f.optionalText(n, Goal.TITLE_MAX) ?? undefined,
  description: (f, n) => f.optionalText(n, Goal.DESCRIPTION_MAX) ?? '',
  sort: (f, n) => f.optionalInteger(n, -SORT_MAX, SORT_MAX) ?? undefined,
};

/** POST /api/goals. 같은 requestId는 처음 만든 것을 돌려준다. parentId가 없으면 맨 위 목표 */
export class CreateGoalInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly parentId: string | null,
    readonly fields: Partial<GoalRow>,
  ) {
    super();
  }

  /** 제목은 꼭 있어야 한다. 먼저 읽어 틀린 칸이 칸 순서대로 모인다 */
  static from(raw: unknown): CreateGoalInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateGoalInput(
          f.uuid('requestId'),
          body.parentId === undefined || body.parentId === null ? null : f.uuid('parentId'),
          { title: f.text('title', Goal.TITLE_MAX), ...f.columns(COLUMNS) },
        ),
    );
  }
}

/** PATCH /api/goals/:id. 본 version을 함께 보낸다 (낙관적 잠금) */
export class UpdateGoalInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly changes: Partial<GoalRow>,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateGoalInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new UpdateGoalInput(f.uuid('id'), f.version(), f.columns(COLUMNS)),
    );
  }
}

/** POST /api/goals/:id/status: active · done · dropped */
export class GoalStatusInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly status: string,
  ) {
    super();
  }

  static from(id: string, raw: unknown): GoalStatusInput {
    return BaseRequest.read(
      { ...(raw as object), id },
      (f) => new GoalStatusInput(f.uuid('id'), f.version(), f.text('status', 20)),
    );
  }
}
