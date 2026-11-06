import { BaseEntity, RuleViolation, TrackedEntity } from '../../platform';
import { HeartbeatPolicy } from './heartbeat.policy';

// 에이전트 하나의 하트비트 (task.heartbeats, 에이전트마다 한 줄). 정해진 시각에 에이전트를 깨워 자기 일을 확인하게 한다.
// 주기는 매일(시각 + 요일) 또는 N시간마다. 켜져 있으면 늘 다음 시각(nextRunAt)이 있다 (DB CHECK).
// 설정은 configure로 한 번에 바꾸고, 때가 되면 fire가 이번 시각을 돌려주고 다음 시각으로 넘어간다.
export class Heartbeat extends TrackedEntity {
  static readonly DAILY = 'daily';
  static readonly HOURLY = 'hourly';
  static readonly MODES: readonly string[] = [Heartbeat.DAILY, Heartbeat.HOURLY];
  static readonly INSTRUCTION_MAX = 4000;
  static readonly DEFAULT_INSTRUCTION = [
    '정기 확인입니다. 맡은 목표와 진행 중인 일을 확인합니다.',
    '할 일이 있으면 하거나 팀에게 맡기고, 없으면 확인한 것을 짧게 보고하고 끝냅니다.',
  ].join('\n');
  /** 하트비트가 만든 작업의 request_id 앞부분 */
  static readonly REQUEST_PREFIX = 'heartbeat:';
  private static readonly MINUTES_PER_DAY = 1440;
  private static readonly HOURS_MAX = 24;
  private static readonly ALL_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly agentId: string,
    private modeValue: string,
    private atMinuteValue: number | null,
    private weekdayList: readonly number[],
    private everyHoursValue: number | null,
    private timeZoneValue: string,
    private instructionValue: string,
    private goalIdValue: string | null,
    private enabledValue: boolean,
    private nextRunValue: Date | null,
    private lastRunValue: Date | null,
    readonly createdAt: Date,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  /** 아직 없는 에이전트의 하트비트. 꺼진 채로 시작하고 configure로 정한다 */
  static open(spaceId: string, agentId: string, now: Date): Heartbeat {
    return new Heartbeat(
      BaseEntity.newId(),
      1,
      spaceId,
      agentId,
      Heartbeat.DAILY,
      9 * 60,
      Heartbeat.ALL_DAYS,
      null,
      'UTC',
      '',
      null,
      false,
      null,
      null,
      now,
      true,
    );
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    agentId: string,
    mode: string,
    atMinute: number | null,
    weekdays: readonly number[],
    everyHours: number | null,
    timeZone: string,
    instruction: string,
    goalId: string | null,
    enabled: boolean,
    nextRunAt: Date | null,
    lastRunAt: Date | null,
    createdAt: Date,
  ): Heartbeat {
    return new Heartbeat(
      id,
      version,
      spaceId,
      agentId,
      mode,
      atMinute,
      weekdays,
      everyHours,
      timeZone,
      instruction,
      goalId,
      enabled,
      nextRunAt,
      lastRunAt,
      createdAt,
      false,
    );
  }

  get mode(): string {
    return this.modeValue;
  }

  get atMinute(): number | null {
    return this.atMinuteValue;
  }

  get weekdays(): readonly number[] {
    return this.weekdayList;
  }

  get everyHours(): number | null {
    return this.everyHoursValue;
  }

  get timeZone(): string {
    return this.timeZoneValue;
  }

  get instruction(): string {
    return this.instructionValue;
  }

  get goalId(): string | null {
    return this.goalIdValue;
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  get nextRunAt(): Date | null {
    return this.nextRunValue;
  }

  get lastRunAt(): Date | null {
    return this.lastRunValue;
  }

  /**
   * 설정을 한 번에 바꾼다. 매일이면 atMinute와 요일, N시간마다면 everyHours만 쓴다.
   * 켜면 지금 뒤의 첫 시각을 다음 시각으로 정하고, 끄면 지운다.
   */
  configure(
    mode: string,
    atMinute: number | null,
    weekdays: readonly number[],
    everyHours: number | null,
    timeZone: string,
    instruction: string,
    goalId: string | null,
    enabled: boolean,
    now: Date,
  ): void {
    if (!Heartbeat.MODES.includes(mode))
      throw new RuleViolation(`주기는 ${Heartbeat.MODES.join(' · ')} 중 하나예요`);
    HeartbeatPolicy.assertTimeZone(timeZone);
    if (instruction.length > Heartbeat.INSTRUCTION_MAX)
      throw new RuleViolation(`지시는 ${Heartbeat.INSTRUCTION_MAX}자까지예요`);
    const daily = mode === Heartbeat.DAILY;
    if (daily && (atMinute === null || atMinute < 0 || atMinute >= Heartbeat.MINUTES_PER_DAY))
      throw new RuleViolation('매일이면 시각(00:00~23:59)이 있어야 해요');
    const days = [...new Set(weekdays)].sort((a, b) => a - b);
    if (daily && (days.length === 0 || days.some((d) => !Heartbeat.ALL_DAYS.includes(d))))
      throw new RuleViolation('요일을 하나 이상 골라 주세요 (월 1 ~ 일 7)');
    if (!daily && (everyHours === null || everyHours < 1 || everyHours > Heartbeat.HOURS_MAX))
      throw new RuleViolation(`N시간마다면 1~${Heartbeat.HOURS_MAX}시간이에요`);
    this.modeValue = mode;
    this.atMinuteValue = daily ? atMinute : null;
    this.weekdayList = daily ? days : Heartbeat.ALL_DAYS;
    this.everyHoursValue = daily ? null : everyHours;
    this.timeZoneValue = timeZone;
    this.instructionValue = instruction;
    this.goalIdValue = goalId;
    this.enabledValue = enabled;
    this.nextRunValue = enabled ? this.after(now) : null;
    this.track('mode', this.modeValue);
    this.track('at_minute', this.atMinuteValue);
    this.track('weekdays', this.weekdayList);
    this.track('every_hours', this.everyHoursValue);
    this.track('time_zone', this.timeZoneValue);
    this.track('instruction', this.instructionValue);
    this.track('goal_id', this.goalIdValue);
    this.track('enabled', this.enabledValue);
    this.track('next_run_at', this.nextRunValue);
  }

  /** 때가 되었는가 (켜져 있고 다음 시각이 지났다) */
  dueAt(now: Date): boolean {
    return this.enabledValue && this.nextRunValue !== null && this.nextRunValue <= now;
  }

  /**
   * 이번 시각을 돌려주고 다음 시각으로 넘어간다. 서버가 꺼져 시각을 여러 번 놓쳤어도 한 번만 깨우고
   * 지금 뒤의 첫 시각으로 간다 (놓친 만큼 몰아서 일하지 않는다).
   */
  fire(now: Date): Date {
    const slot = this.nextRunValue;
    if (!this.dueAt(now) || slot === null) throw new RuleViolation('아직 깨울 때가 아니에요');
    this.lastRunValue = now;
    this.nextRunValue = this.after(now);
    this.track('last_run_at', now);
    this.track('next_run_at', this.nextRunValue);
    return slot;
  }

  /** 이 시각에 만드는 작업의 제목: 시간대 기준 날짜와 시각 */
  titleFor(slot: Date): string {
    const at = new Intl.DateTimeFormat('ko-KR', {
      timeZone: this.timeZoneValue,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(slot);
    return `정기 확인 (${at})`;
  }

  /** 만드는 작업의 지시. 주인이 정하지 않았으면 기본 지시 */
  get taskInstruction(): string {
    return this.instructionValue.trim() || Heartbeat.DEFAULT_INSTRUCTION;
  }

  /** 이 시각에 만드는 작업의 request_id. 일꾼이 두 번 돌아도 작업은 하나다 */
  requestIdFor(slot: Date): string {
    return `${Heartbeat.REQUEST_PREFIX}${this.agentId}:${slot.toISOString()}`;
  }

  private after(now: Date): Date {
    return this.modeValue === Heartbeat.DAILY
      ? HeartbeatPolicy.nextDaily(
          this.atMinuteValue ?? 0,
          this.weekdayList,
          this.timeZoneValue,
          now,
        )
      : HeartbeatPolicy.nextHourly(this.everyHoursValue ?? 1, this.timeZoneValue, now);
  }
}
