import { BaseEntity, RuleViolation } from '../../platform';

// AI 도구 구독의 사용률 창 하나. 러너가 본 마지막 값만 두고, 초기화 시각이 지나면 확인 전으로 본다.
// 기록을 쌓지 않는 표라 id 대신 공간·도구·창으로 찾고 버전을 세지 않는다.
export class PlanUsage extends BaseEntity {
  static readonly FIVE_HOUR = 'five_hour';
  static readonly SEVEN_DAY = 'seven_day';
  /** 저장하는 창. 늘 이 순서로 저장해서 동시에 온 보고가 서로를 막지 않는다 */
  static readonly WINDOWS: readonly string[] = [PlanUsage.FIVE_HOUR, PlanUsage.SEVEN_DAY];
  static readonly PERCENT_MAX = 1000;
  static readonly STATUSES: readonly string[] = ['allowed', 'allowed_warning', 'rejected'];

  private constructor(
    readonly spaceId: string,
    readonly tool: string,
    readonly window: string,
    readonly percent: number,
    readonly resetsAt: Date,
    /** CLI가 알리지 않으면 null */
    readonly status: string | null,
    readonly seenAt: Date,
  ) {
    super(`${spaceId}/${tool}/${window}`, 1);
  }

  /** 러너가 지금 본 값. 어느 도구의 값인지는 작업의 에이전트가 정한다 */
  static seen(
    spaceId: string,
    tool: string,
    window: string,
    percent: number,
    resetsAt: Date,
    status: string | null,
    now: Date,
  ): PlanUsage {
    if (!PlanUsage.WINDOWS.includes(window))
      throw new RuleViolation(`구독 사용률 창은 ${PlanUsage.WINDOWS.join(' · ')} 중 하나예요`);
    if (percent < 0 || percent > PlanUsage.PERCENT_MAX)
      throw new RuleViolation(`구독 사용률은 0~${PlanUsage.PERCENT_MAX}이에요`);
    if (status !== null && !PlanUsage.STATUSES.includes(status))
      throw new RuleViolation(`모르는 구독 상태예요: ${status}`);
    return new PlanUsage(spaceId, tool, window, percent, resetsAt, status, now);
  }

  static restore(
    spaceId: string,
    tool: string,
    window: string,
    percent: number,
    resetsAt: Date,
    status: string | null,
    seenAt: Date,
  ): PlanUsage {
    return new PlanUsage(spaceId, tool, window, percent, resetsAt, status, seenAt);
  }

  /** 아직 믿을 수 있는 값인가. 초기화 시각이 지나면 그 창의 사용률을 알 수 없다 */
  validAt(now: Date): boolean {
    return this.resetsAt.getTime() > now.getTime();
  }

  /** 이 도구의 유효한 창 중 가장 높은 사용률. 하나도 없으면 null (확인 전) */
  static highest(list: readonly PlanUsage[], tool: string, now: Date): number | null {
    const valid = list.filter((p) => p.tool === tool && p.validAt(now)).map((p) => p.percent);
    return valid.length === 0 ? null : Math.max(...valid);
  }
}
