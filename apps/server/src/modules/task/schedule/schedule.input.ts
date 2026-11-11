import { BaseRequest, type RequestFields } from '../../platform';
import type { ScheduleRow } from '../task.tables';
import { Schedule } from './schedule';

// 스케줄 입력의 모양. 뜻(주기, 시간대, 요일 범위, 한도)은 Schedule이 검사한다.
// 설정을 한 번에 바꾸는 입력이라 만들기 · 고치기 모두 칸을 다 읽는다. 시각은 API에서 atTime("09:30"), 칸은 at_minute(570).

const VERSION_MAX = 2_147_483_647;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 만들기 · 고치기의 설정 칸. 매일이면 atTime과 weekdays(월 1 ~ 일 7), N시간마다면 everyHours */
function settingsOf(f: RequestFields, body: Record<string, unknown>): Partial<ScheduleRow> {
  return {
    title: f.text('title', Schedule.TITLE_MAX),
    agent_id: body.agentId === undefined || body.agentId === null ? null : f.uuid('agentId'),
    enabled: f.boolean('enabled'),
    mode: f.text('mode', 20),
    at_minute: minuteOf(f, body.atTime),
    weekdays: weekdaysOf(f, body.weekdays),
    every_hours: f.optionalInteger('everyHours', 1, 24),
    time_zone: f.text('timeZone', 100),
    instruction: f.optionalText('instruction', Schedule.INSTRUCTION_MAX) ?? '',
    goal_id: body.goalId === undefined || body.goalId === null ? null : f.uuid('goalId'),
    daily_max: f.integer('dailyMax', 1, Schedule.DAILY_MAX_LIMIT),
  };
}

/** "09:30" → 570. 없으면 null */
function minuteOf(f: RequestFields, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const match = typeof value === 'string' ? TIME.exec(value) : null;
  if (!match) {
    f.reject('atTime', '00:00~23:59 모양이어야 해요');
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 요일 숫자 목록. 없으면 매일 */
function weekdaysOf(f: RequestFields, value: unknown): readonly number[] {
  if (value === undefined || value === null) return [1, 2, 3, 4, 5, 6, 7];
  if (!Array.isArray(value) || value.length > 7 || !value.every(Number.isInteger)) {
    f.reject('weekdays', '요일 숫자(월 1 ~ 일 7) 목록이어야 해요');
    return [];
  }
  return value as number[];
}

/** POST /api/schedules. 같은 requestId가 다시 오면 처음 만든 스케줄 */
export class CreateScheduleInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly settings: Partial<ScheduleRow>,
  ) {
    super();
  }

  static from(raw: unknown): CreateScheduleInput {
    const body = { ...(raw as object) } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) => new CreateScheduleInput(f.text('requestId', 200), settingsOf(f, body)),
    );
  }
}

/** PATCH /api/schedules/:id. 본 version과 설정 전부 */
export class UpdateScheduleInput extends BaseRequest {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly settings: Partial<ScheduleRow>,
  ) {
    super();
  }

  static from(id: string, raw: unknown): UpdateScheduleInput {
    const body = { ...(raw as object), id } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new UpdateScheduleInput(
          f.uuid('id'),
          f.integer('version', 1, VERSION_MAX),
          settingsOf(f, body),
        ),
    );
  }
}

/** GET /api/schedules?agentId= */
export class ListSchedulesInput extends BaseRequest {
  private constructor(readonly agentId: string | null) {
    super();
  }

  static from(raw: unknown): ListSchedulesInput {
    const query = (raw ?? {}) as Record<string, unknown>;
    return BaseRequest.read(
      query,
      (f) =>
        new ListSchedulesInput(
          query.agentId === undefined || query.agentId === '' ? null : f.uuid('agentId'),
        ),
    );
  }
}
