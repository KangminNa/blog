import { TableRepository } from '../../platform';
import { schedules } from '../task.schema';
import type { ScheduleRow } from '../task.tables';
import { Schedule } from './schedule';

// task.schedules ↔ Schedule. 저장은 기반이 하고(바뀐 칸만, version으로 늦은 쓰기를 막는다), 여기에는 찾는 SQL만 있다.
export class ScheduleRepository extends TableRepository<ScheduleRow, Schedule> {
  protected readonly table = schedules;
  protected readonly noun = '스케줄';

  protected toEntity(row: ScheduleRow): Schedule {
    return Schedule.restore(row);
  }

  /** 켜져 있고 때가 된 스케줄을 때 순서로 잠근다 (모든 공간). 다른 일꾼이 잡은 줄은 건너뛴다 */
  async lockDue(now: Date, limit: number): Promise<readonly Schedule[]> {
    // 칸 자체를 조건으로: 조건 규칙의 enabled = $1은 일반 계획에서 부분 색인 schedules_due_idx(WHERE enabled)를 못 쓴다
    const rows = await this.sql<ScheduleRow[]>`
      SELECT * FROM task.schedules WHERE enabled AND next_run_at <= ${now}
      ORDER BY next_run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 지운다 (설정이라 판을 남기지 않는다. 이미 만든 작업은 그대로) */
  async remove(schedule: Schedule): Promise<void> {
    await this.deleteRows(schedules, { space_id: schedule.spaceId, id: schedule.id });
  }
}
