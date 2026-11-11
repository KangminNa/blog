import { BaseEntity, RuleViolation, TableEntity } from '../../platform';
import type { Goal } from '../goal/goal';
import { Task } from '../task/task';
import type { ScheduleNew, ScheduleRow } from '../task.tables';
import { SchedulePolicy } from './schedule.policy';
import { ScheduleView } from './schedule.view';

// 스케줄 하나 (task.schedules, 7단계). 정해진 시각에 지시대로 작업을 만든다. 하트비트를 넓힌 것이다:
// 담당이 정해져 있고 지시가 비어 있으면 "정기 확인"(맡은 목표와 진행 중인 일을 확인)이 된다.
// 주기는 매일(시각 + 요일) 또는 N시간마다. 켜져 있으면 늘 다음 시각(next_run_at)이 있다 (DB CHECK).
// 하루 한도(daily_max): 스케줄의 시간대 기준 하루에 만드는 작업 수. 구독 AI를 사람 없이 돌리는 양을 묶는다 (기획서 11장).
// 설정은 configure로 한 번에 바꾸고, 때가 되면 fire가 이번 시각을 돌려주고 다음 시각으로 넘어간다.
// 작업을 만들 차례인지(하루 한도)는 claimRun이 정한다: 앞 작업이 안 끝났거나 에이전트가 쉬어 건너뛴 것은 세지 않는다.
export class Schedule extends TableEntity<ScheduleRow, ScheduleNew> {
  static readonly DAILY = 'daily';
  static readonly HOURLY = 'hourly';
  static readonly MODES: readonly string[] = [Schedule.DAILY, Schedule.HOURLY];
  static readonly TITLE_MAX = 120;
  static readonly INSTRUCTION_MAX = 4000;
  /** 하루 한도의 끝 (N시간마다 1시간이면 하루 24번) */
  static readonly DAILY_MAX_LIMIT = 24;
  static readonly DEFAULT_INSTRUCTION = [
    '정기 확인입니다. 맡은 목표와 진행 중인 일을 확인합니다.',
    '할 일이 있으면 하거나 팀에게 맡기고, 없으면 확인한 것을 짧게 보고하고 끝냅니다.',
  ].join('\n');
  /** 스케줄이 만든 작업의 request_id 앞부분 */
  static readonly REQUEST_PREFIX = 'schedule:';
  private static readonly MINUTES_PER_DAY = 1440;
  private static readonly HOURS_MAX = 24;
  private static readonly ALL_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

  /** 새 스케줄. 설정은 configure로 정한다 (만들 때도 같은 규칙) */
  static open(spaceId: string, settings: Partial<ScheduleRow>, now: Date): Schedule {
    const schedule = new Schedule(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        title: '',
        agent_id: null,
        mode: Schedule.DAILY,
        at_minute: 9 * 60,
        weekdays: Schedule.ALL_DAYS,
        every_hours: null,
        time_zone: 'UTC',
        instruction: '',
        goal_id: null,
        daily_max: 3,
        run_day: null,
        day_runs: 0,
        enabled: false,
        next_run_at: null,
        last_run_at: null,
        created_at: now,
      },
      true,
    );
    schedule.configure(settings, now);
    return schedule;
  }

  static restore(row: ScheduleRow): Schedule {
    return new Schedule(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get agentId(): string | null {
    return this.row.agent_id;
  }

  get goalId(): string | null {
    return this.row.goal_id;
  }

  get title(): string {
    return this.row.title;
  }

  /**
   * 설정을 한 번에 바꾼다. 매일이면 at_minute와 요일, N시간마다면 every_hours만 쓴다.
   * 켜면 지금 뒤의 첫 시각을 다음 시각으로 정하고, 끄면 지운다. 오늘 센 수(day_runs)는 그대로 둔다
   */
  configure(settings: Partial<ScheduleRow>, now: Date): void {
    const {
      title = '',
      agent_id: agentId = null,
      mode = '',
      at_minute: atMinute = null,
      weekdays = [],
      every_hours: everyHours = null,
      time_zone: timeZone = '',
      instruction = '',
      goal_id: goalId = null,
      daily_max: dailyMax = 0,
      enabled = false,
    } = settings;
    const name = title.trim();
    if (name.length < 1 || name.length > Schedule.TITLE_MAX)
      throw new RuleViolation(`이름은 1~${Schedule.TITLE_MAX}자예요`);
    if (!Schedule.MODES.includes(mode))
      throw new RuleViolation(`주기는 ${Schedule.MODES.join(' · ')} 중 하나예요`);
    SchedulePolicy.assertTimeZone(timeZone);
    if (instruction.length > Schedule.INSTRUCTION_MAX)
      throw new RuleViolation(`지시는 ${Schedule.INSTRUCTION_MAX}자까지예요`);
    if (agentId === null && instruction.trim() === '')
      throw new RuleViolation('담당을 정하지 않으면 지시를 적어 주세요');
    const daily = mode === Schedule.DAILY;
    if (daily && (atMinute === null || atMinute < 0 || atMinute >= Schedule.MINUTES_PER_DAY))
      throw new RuleViolation('매일이면 시각(00:00~23:59)이 있어야 해요');
    const days = [...new Set(weekdays)].sort((a, b) => a - b);
    if (daily && (days.length === 0 || days.some((d) => !Schedule.ALL_DAYS.includes(d))))
      throw new RuleViolation('요일을 하나 이상 골라 주세요 (월 1 ~ 일 7)');
    if (!daily && (everyHours === null || everyHours < 1 || everyHours > Schedule.HOURS_MAX))
      throw new RuleViolation(`N시간마다면 1~${Schedule.HOURS_MAX}시간이에요`);
    if (!Number.isInteger(dailyMax) || dailyMax < 1 || dailyMax > Schedule.DAILY_MAX_LIMIT)
      throw new RuleViolation(`하루 한도는 1~${Schedule.DAILY_MAX_LIMIT}번이에요`);
    this.put('title', name);
    this.put('agent_id', agentId);
    this.put('mode', mode);
    this.put('at_minute', daily ? atMinute : null);
    this.put('weekdays', daily ? days : Schedule.ALL_DAYS);
    this.put('every_hours', daily ? null : everyHours);
    this.put('time_zone', timeZone);
    this.put('instruction', instruction);
    this.put('goal_id', goalId);
    this.put('daily_max', dailyMax);
    this.put('enabled', enabled);
    this.put('next_run_at', enabled ? this.after(now) : null);
  }

  /** 때가 되었는가 (켜져 있고 다음 시각이 지났다) */
  dueAt(now: Date): boolean {
    const next = this.row.next_run_at;
    return this.row.enabled && next !== null && next <= now;
  }

  /**
   * 이번 시각을 돌려주고 다음 시각으로 넘어간다. 서버가 꺼져 시각을 여러 번 놓쳤어도 한 번만 깨우고
   * 지금 뒤의 첫 시각으로 간다 (놓친 만큼 몰아서 일하지 않는다). 작업을 만들지는 claimRun이 정한다
   */
  fire(now: Date): Date {
    const slot = this.row.next_run_at;
    if (!this.dueAt(now) || slot === null) throw new RuleViolation('아직 돌 때가 아니에요');
    this.put('last_run_at', now);
    this.put('next_run_at', this.after(now));
    return slot;
  }

  /**
   * 오늘(시간대 기준) 작업을 하나 더 만들 수 있으면 하나를 세고 true, 하루 한도에 닿았으면 false.
   * 날이 바뀌면 다시 0부터 센다
   */
  claimRun(now: Date): boolean {
    const today = SchedulePolicy.dayOf(now, this.row.time_zone);
    const used = this.row.run_day === today ? this.row.day_runs : 0;
    if (used >= this.row.daily_max) return false;
    this.put('run_day', today);
    this.put('day_runs', used + 1);
    return true;
  }

  /** 주인이 누른 "지금 한 번". 하루 한도에 함께 센다. 닿았으면 RuleViolation */
  runNow(now: Date): Date {
    if (!this.claimRun(now))
      throw new RuleViolation(`오늘 한도(${this.row.daily_max}번)에 닿았어요. 내일 다시 돌아요`);
    return now;
  }

  /** 이 시각에 만드는 작업. 목표가 닫혔으면 목표 없이. 담당이 없으면 빌릴 때 자동 배정 */
  wake(slot: Date, goal: Goal | null, now: Date): Task {
    return Task.open(
      this.row.space_id,
      this.requestIdFor(slot),
      {
        agent_id: this.row.agent_id,
        kind: Task.GENERAL,
        title: this.titleFor(slot),
        instruction: this.taskInstruction,
        payload: { schedule: { id: this.id, at: slot.toISOString() } },
        goal_id: goal?.active ? goal.id : null,
      },
      now,
    );
  }

  /** 이 시각에 만드는 작업의 제목: 스케줄 이름과 시간대 기준 날짜 · 시각 */
  titleFor(slot: Date): string {
    const at = new Intl.DateTimeFormat('ko-KR', {
      timeZone: this.row.time_zone,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(slot);
    return `${this.row.title} (${at})`.slice(0, 200);
  }

  /** 만드는 작업의 지시. 비어 있으면 정기 확인 */
  get taskInstruction(): string {
    return this.row.instruction.trim() || Schedule.DEFAULT_INSTRUCTION;
  }

  /** 이 스케줄이 만든 작업의 request_id 앞부분 (앞 작업이 끝났는지 볼 때) */
  get requestPrefix(): string {
    return `${Schedule.REQUEST_PREFIX}${this.id}:`;
  }

  /** 이 시각에 만드는 작업의 request_id. 일꾼이 두 번 돌아도 작업은 하나다 */
  requestIdFor(slot: Date): string {
    return `${this.requestPrefix}${slot.toISOString()}`;
  }

  view(): ScheduleView {
    return new ScheduleView(this.row);
  }

  private after(now: Date): Date {
    const r = this.row;
    return r.mode === Schedule.DAILY
      ? SchedulePolicy.nextDaily(r.at_minute ?? 0, r.weekdays, r.time_zone, now)
      : SchedulePolicy.nextHourly(r.every_hours ?? 1, r.time_zone, now);
  }
}
