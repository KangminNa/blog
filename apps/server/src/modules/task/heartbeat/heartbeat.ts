import { BaseEntity, RuleViolation, TableEntity } from '../../platform';
import { AgentHeartbeatView } from '../agent/agent.view';
import type { Goal } from '../goal/goal';
import { Task } from '../task/task';
import type { HeartbeatNew, HeartbeatRow } from '../task.tables';
import { HeartbeatPolicy } from './heartbeat.policy';

// 에이전트 하나의 하트비트 (task.heartbeats, 에이전트마다 한 줄). 정해진 시각에 에이전트를 깨워 자기 일을 확인하게 한다.
// 주기는 매일(시각 + 요일) 또는 N시간마다. 켜져 있으면 늘 다음 시각(next_run_at)이 있다 (DB CHECK).
// 설정은 configure로 한 번에 바꾸고, 때가 되면 fire가 이번 시각을 돌려주고 다음 시각으로 넘어간다.
export class Heartbeat extends TableEntity<HeartbeatRow, HeartbeatNew> {
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

  /** 아직 없는 에이전트의 하트비트. 꺼진 채로 시작하고 configure로 정한다 */
  static open(spaceId: string, agentId: string, now: Date): Heartbeat {
    return new Heartbeat(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        agent_id: agentId,
        mode: Heartbeat.DAILY,
        at_minute: 9 * 60,
        weekdays: Heartbeat.ALL_DAYS,
        every_hours: null,
        time_zone: 'UTC',
        instruction: '',
        goal_id: null,
        enabled: false,
        next_run_at: null,
        last_run_at: null,
        created_at: now,
      },
      true,
    );
  }

  static restore(row: HeartbeatRow): Heartbeat {
    return new Heartbeat(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get agentId(): string {
    return this.row.agent_id;
  }

  get goalId(): string | null {
    return this.row.goal_id;
  }

  /**
   * 설정을 한 번에 바꾼다. 매일이면 at_minute와 요일, N시간마다면 every_hours만 쓴다.
   * 켜면 지금 뒤의 첫 시각을 다음 시각으로 정하고, 끄면 지운다.
   */
  configure(settings: Partial<HeartbeatRow>, now: Date): void {
    const {
      mode = '',
      at_minute: atMinute = null,
      weekdays = [],
      every_hours: everyHours = null,
      time_zone: timeZone = '',
      instruction = '',
      goal_id: goalId = null,
      enabled = false,
    } = settings;
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
    this.put('mode', mode);
    this.put('at_minute', daily ? atMinute : null);
    this.put('weekdays', daily ? days : Heartbeat.ALL_DAYS);
    this.put('every_hours', daily ? null : everyHours);
    this.put('time_zone', timeZone);
    this.put('instruction', instruction);
    this.put('goal_id', goalId);
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
   * 지금 뒤의 첫 시각으로 간다 (놓친 만큼 몰아서 일하지 않는다).
   */
  fire(now: Date): Date {
    const slot = this.row.next_run_at;
    if (!this.dueAt(now) || slot === null) throw new RuleViolation('아직 깨울 때가 아니에요');
    this.put('last_run_at', now);
    this.put('next_run_at', this.after(now));
    return slot;
  }

  /** 이 시각에 만드는 작업. 목표가 닫혔으면 목표 없이 */
  wake(slot: Date, goal: Goal | null, now: Date): Task {
    return Task.open(
      this.row.space_id,
      this.requestIdFor(slot),
      {
        agent_id: this.row.agent_id,
        kind: Task.GENERAL,
        title: this.titleFor(slot),
        instruction: this.taskInstruction,
        payload: { heartbeat: slot.toISOString() },
        goal_id: goal?.active ? goal.id : null,
      },
      now,
    );
  }

  /** 이 시각에 만드는 작업의 제목: 시간대 기준 날짜와 시각 */
  titleFor(slot: Date): string {
    const at = new Intl.DateTimeFormat('ko-KR', {
      timeZone: this.row.time_zone,
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
    return this.row.instruction.trim() || Heartbeat.DEFAULT_INSTRUCTION;
  }

  /** 이 시각에 만드는 작업의 request_id. 일꾼이 두 번 돌아도 작업은 하나다 */
  requestIdFor(slot: Date): string {
    return `${Heartbeat.REQUEST_PREFIX}${this.row.agent_id}:${slot.toISOString()}`;
  }

  /** 정한 하트비트. 에이전트 목록의 heartbeat와 같은 모양이다 */
  view(): AgentHeartbeatView {
    return new AgentHeartbeatView(this.row);
  }

  private after(now: Date): Date {
    const r = this.row;
    return r.mode === Heartbeat.DAILY
      ? HeartbeatPolicy.nextDaily(r.at_minute ?? 0, r.weekdays, r.time_zone, now)
      : HeartbeatPolicy.nextHourly(r.every_hours ?? 1, r.time_zone, now);
  }
}
