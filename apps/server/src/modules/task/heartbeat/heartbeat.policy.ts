import { RuleViolation } from '../../platform';

// 하트비트의 다음 시각. 크론 라이브러리 없이 두 가지 주기만 계산한다 (2026-11-06 결정).
//   매일: 시간대 기준 정한 시각(분), 고른 요일에만
//   N시간마다: 시간대 기준 정각 중 시가 N으로 나누어떨어질 때 (4시간마다 → 0·4·8·12·16·20시)
// 시간대는 IANA 이름이고, 오프셋은 JavaScript에 들어 있는 Intl로 그때그때 구한다 (서머타임 포함).
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 시각 규칙 한 곳. 설정 저장과 일꾼의 깨우기가 함께 쓴다
export class HeartbeatPolicy {
  private static readonly MINUTE_MS = 60_000;
  private static readonly HOUR_MS = 3_600_000;
  /** 요일을 몇 개 골랐든 다음 시각은 8일 안에 있다 */
  private static readonly DAYS_AHEAD = 8;
  /** N시간마다는 이틀 안에 있다 (24시간마다 → 0시) */
  private static readonly HOURS_AHEAD = 48;
  private static readonly WEEKDAYS: Readonly<Record<string, number>> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  /** 알 수 없는 시간대면 RuleViolation */
  static assertTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new RuleViolation(`알 수 없는 시간대예요: ${timeZone}`);
    }
  }

  /** after보다 뒤의 첫 시각: 매일 atMinute(하루 중 분), 고른 ISO 요일(월 1 ~ 일 7)에만 */
  static nextDaily(
    atMinute: number,
    weekdays: readonly number[],
    timeZone: string,
    after: Date,
  ): Date {
    const today = HeartbeatPolicy.local(after, timeZone);
    for (let day = 0; day <= HeartbeatPolicy.DAYS_AHEAD; day++) {
      const date = new Date(Date.UTC(today.year, today.month - 1, today.day + day));
      const at = HeartbeatPolicy.instant(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        atMinute,
        timeZone,
      );
      const weekday = HeartbeatPolicy.local(at, timeZone).weekday;
      if (at.getTime() > after.getTime() && weekdays.includes(weekday)) return at;
    }
    throw new RuleViolation('다음 시각을 찾지 못했어요');
  }

  /** after보다 뒤의 첫 정각 중 시간대 기준 시가 everyHours로 나누어떨어지는 때 */
  static nextHourly(everyHours: number, timeZone: string, after: Date): Date {
    const start = Math.floor(after.getTime() / HeartbeatPolicy.HOUR_MS) * HeartbeatPolicy.HOUR_MS;
    for (let step = 0; step <= HeartbeatPolicy.HOURS_AHEAD; step++) {
      // 시간대 오프셋이 30·45분인 곳도 있어 정각은 그 시간대의 정각으로 맞춘다
      const guess = new Date(start + step * HeartbeatPolicy.HOUR_MS);
      const local = HeartbeatPolicy.local(guess, timeZone);
      const at = new Date(guess.getTime() - local.minute * HeartbeatPolicy.MINUTE_MS);
      if (at.getTime() > after.getTime() && local.hour % everyHours === 0) return at;
    }
    throw new RuleViolation('다음 시각을 찾지 못했어요');
  }

  /** 그 시간대에서 하루 중 분(atMinute)이 되는 순간. 서머타임으로 없는 시각이면 앞으로 민다 */
  private static instant(
    year: number,
    month: number,
    day: number,
    atMinute: number,
    timeZone: string,
  ): Date {
    const wall = Date.UTC(year, month - 1, day, Math.floor(atMinute / 60), atMinute % 60);
    let guess = wall - HeartbeatPolicy.offset(new Date(wall), timeZone);
    guess = wall - HeartbeatPolicy.offset(new Date(guess), timeZone);
    return new Date(guess);
  }

  /** 그 순간의 시간대 오프셋 (밀리초, UTC보다 빠르면 양수) */
  private static offset(at: Date, timeZone: string): number {
    const l = HeartbeatPolicy.local(at, timeZone);
    const wall = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
    return wall - Math.floor(at.getTime() / HeartbeatPolicy.MINUTE_MS) * HeartbeatPolicy.MINUTE_MS;
  }

  /** 그 순간을 시간대의 벽시계로 읽는다 */
  private static local(at: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    }).formatToParts(at);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return {
      year: Number(part('year')),
      month: Number(part('month')),
      day: Number(part('day')),
      hour: Number(part('hour')),
      minute: Number(part('minute')),
      weekday: HeartbeatPolicy.WEEKDAYS[part('weekday')] ?? 0,
    };
  }
}
