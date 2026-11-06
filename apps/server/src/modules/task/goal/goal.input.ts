import { BaseRequest } from '../../platform';
import { Goal } from './goal';

// 목표 입력의 모양. 뜻(빈 제목, 상태 이름, 깊이)은 Goal이 검사한다.

const VERSION_MAX = 2_147_483_647;
const SORT_MAX = 1_000_000;

/** POST /api/goals. 같은 requestId는 처음 만든 것을 돌려준다. parentId가 없으면 맨 위 목표 */
export class CreateGoalInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly parentId: string | null,
    readonly title: string,
    readonly description: string,
    readonly sort: number,
  ) {
    super();
  }

  static from(raw: unknown): CreateGoalInput {
    const body = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      raw,
      (f) =>
        new CreateGoalInput(
          f.uuid('requestId'),
          body.parentId === undefined || body.parentId === null ? null : f.uuid('parentId'),
          f.text('title', Goal.TITLE_MAX),
          f.optionalText('description', Goal.DESCRIPTION_MAX) ?? '',
          f.optionalInteger('sort', -SORT_MAX, SORT_MAX) ?? 0,
        ),
    );
  }
}

/** PATCH /api/goals/:id. 보내지 않은 칸은 그대로. 본 version을 함께 보낸다 (낙관적 잠금) */
export class UpdateGoalInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly title: string | null,
    readonly description: string | null,
    readonly sort: number | null,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateGoalInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new UpdateGoalInput(
          f.uuid('id'),
          f.integer('version', 1, VERSION_MAX),
          f.optionalText('title', Goal.TITLE_MAX),
          'description' in body
            ? (f.optionalText('description', Goal.DESCRIPTION_MAX) ?? '')
            : null,
          f.optionalInteger('sort', -SORT_MAX, SORT_MAX),
        ),
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
      (f) =>
        new GoalStatusInput(
          f.uuid('id'),
          f.integer('version', 1, VERSION_MAX),
          f.text('status', 20),
        ),
    );
  }
}
