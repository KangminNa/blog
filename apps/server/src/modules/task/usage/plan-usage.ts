import { BaseEntity, RuleViolation } from '../../platform';
import type { PlanUsageRow } from '../task.tables';
import { PlanWindowView } from './usage.view';

// AI 도구 구독의 사용률 창 하나. 러너가 본 마지막 값만 두고, 초기화 시각이 지나면 확인 전으로 본다.
// 기록을 쌓지 않는 표라 id 대신 공간·도구·창으로 찾고 버전을 세지 않는다. 그래서 TableEntity가 아니다.
export class PlanUsage extends BaseEntity {
  static readonly FIVE_HOUR = 'five_hour';
  static readonly SEVEN_DAY = 'seven_day';
  /** 저장하는 창. 늘 이 순서로 저장해서 동시에 온 보고가 서로를 막지 않는다 */
  static readonly WINDOWS: readonly string[] = [PlanUsage.FIVE_HOUR, PlanUsage.SEVEN_DAY];
  static readonly PERCENT_MAX = 1000;
  static readonly STATUSES: readonly string[] = ['allowed', 'allowed_warning', 'rejected'];

  private constructor(private readonly row: Readonly<PlanUsageRow>) {
    super(`${row.space_id}/${row.tool}/${row.period}`, 1);
  }

  /** 러너가 지금 본 값. 어느 도구의 값인지는 작업의 에이전트가 정한다 */
  static seen(
    spaceId: string,
    tool: string,
    fields: Pick<PlanUsageRow, 'period' | 'percent' | 'resets_at' | 'status'>,
    now: Date,
  ): PlanUsage {
    const { period, percent, status } = fields;
    if (!PlanUsage.WINDOWS.includes(period))
      throw new RuleViolation(`구독 사용률 창은 ${PlanUsage.WINDOWS.join(' · ')} 중 하나예요`);
    if (percent < 0 || percent > PlanUsage.PERCENT_MAX)
      throw new RuleViolation(`구독 사용률은 0~${PlanUsage.PERCENT_MAX}이에요`);
    if (status !== null && !PlanUsage.STATUSES.includes(status))
      throw new RuleViolation(`모르는 구독 상태예요: ${status}`);
    return new PlanUsage({ ...fields, space_id: spaceId, tool, seen_at: now });
  }

  static restore(row: PlanUsageRow): PlanUsage {
    return new PlanUsage(row);
  }

  /** 이 도구의 유효한 창 중 가장 높은 사용률. 하나도 없으면 null (확인 전) */
  static highest(list: readonly PlanUsage[], tool: string, now: Date): number | null {
    const valid = list.filter((p) => p.tool === tool && p.validAt(now)).map((p) => p.row.percent);
    return valid.length === 0 ? null : Math.max(...valid);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get tool(): string {
    return this.row.tool;
  }

  /** 저장할 행. Repository가 부른다 */
  get unsaved(): Readonly<PlanUsageRow> {
    return this.row;
  }

  /** 이 도구의 이 창인가 */
  covers(tool: string, window: string): boolean {
    return this.row.tool === tool && this.row.period === window;
  }

  /** 아직 믿을 수 있는 값인가. 초기화 시각이 지나면 그 창의 사용률을 알 수 없다 */
  validAt(now: Date): boolean {
    return this.row.resets_at.getTime() > now.getTime();
  }

  view(now: Date): PlanWindowView {
    return new PlanWindowView(this.row.tool, this.row.period, this.row, this.validAt(now));
  }
}
