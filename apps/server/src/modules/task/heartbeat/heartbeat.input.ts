import { BaseRequest, type RequestFields } from '../../platform';
import { Heartbeat } from './heartbeat';

// 하트비트 입력의 모양. 뜻(주기, 시간대, 요일 범위)은 Heartbeat가 검사한다.

const VERSION_MAX = 2_147_483_647;

/**
 * PUT /api/agents/:id/heartbeat. 처음 정할 때 version은 0, 고칠 때는 본 version.
 * 매일이면 atTime("09:30")과 weekdays(월 1 ~ 일 7), N시간마다면 everyHours
 */
export class HeartbeatInput extends BaseRequest {
  private static readonly TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

  private constructor(
    readonly agentId: string,
    readonly version: number,
    readonly enabled: boolean,
    readonly mode: string,
    readonly atMinute: number | null,
    readonly weekdays: readonly number[],
    readonly everyHours: number | null,
    readonly timeZone: string,
    readonly instruction: string,
    readonly goalId: string | null,
  ) {
    super();
  }

  static from(agentId: string, raw: unknown): HeartbeatInput {
    const body = { ...(raw as object), agentId } as Record<string, unknown>;
    return BaseRequest.read(
      body,
      (f) =>
        new HeartbeatInput(
          f.uuid('agentId'),
          f.integer('version', 0, VERSION_MAX),
          f.boolean('enabled'),
          f.text('mode', 20),
          HeartbeatInput.minuteOf(f, body.atTime),
          HeartbeatInput.weekdaysOf(f, body.weekdays),
          f.optionalInteger('everyHours', 1, 24),
          f.text('timeZone', 100),
          f.optionalText('instruction', Heartbeat.INSTRUCTION_MAX) ?? '',
          body.goalId === undefined || body.goalId === null ? null : f.uuid('goalId'),
        ),
    );
  }

  /** "09:30" → 570. 없으면 null */
  private static minuteOf(f: RequestFields, value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const match = typeof value === 'string' ? HeartbeatInput.TIME.exec(value) : null;
    if (!match) {
      f.reject('atTime', '00:00~23:59 모양이어야 해요');
      return null;
    }
    return Number(match[1]) * 60 + Number(match[2]);
  }

  /** 요일 숫자 목록. 없으면 매일 */
  private static weekdaysOf(f: RequestFields, value: unknown): readonly number[] {
    if (value === undefined || value === null) return [1, 2, 3, 4, 5, 6, 7];
    if (!Array.isArray(value) || value.length > 7 || !value.every(Number.isInteger)) {
      f.reject('weekdays', '요일 숫자(월 1 ~ 일 7) 목록이어야 해요');
      return [];
    }
    return value as number[];
  }
}
