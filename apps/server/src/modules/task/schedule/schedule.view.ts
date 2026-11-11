import type { ScheduleRow } from '../task.tables';

// 스케줄의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장). 주인만 본다.

/** 스케줄 하나. 시각은 API에서 atTime("09:30"), 칸은 at_minute(570) */
export class ScheduleView {
  constructor(private readonly row: Readonly<ScheduleRow>) {}

  toJSON() {
    const r = this.row;
    const at = r.at_minute;
    return {
      id: r.id,
      title: r.title,
      agentId: r.agent_id,
      enabled: r.enabled,
      mode: r.mode,
      atTime:
        at === null
          ? null
          : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`,
      weekdays: r.weekdays,
      everyHours: r.every_hours,
      timeZone: r.time_zone,
      instruction: r.instruction,
      goalId: r.goal_id,
      dailyMax: r.daily_max,
      /** 이 날(시간대 기준)에 만든 작업 수. 화면이 오늘인지 견준다 */
      runDay: r.run_day,
      dayRuns: r.day_runs,
      nextRunAt: r.next_run_at?.toISOString() ?? null,
      lastRunAt: r.last_run_at?.toISOString() ?? null,
      version: r.version,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 스케줄 목록. 몇 개뿐이라 한 쪽에 다 보낸다 */
export class ScheduleListView {
  constructor(private readonly rows: readonly Readonly<ScheduleRow>[]) {}

  toJSON() {
    return { schedules: this.rows.map((r) => new ScheduleView(r).toJSON()) };
  }
}
