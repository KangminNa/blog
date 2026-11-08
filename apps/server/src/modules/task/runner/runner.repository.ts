import { TableRepository } from '../../platform';
import { runners } from '../task.schema';
import type { RunnerRow } from '../task.tables';
import { Runner } from './runner';

// task.runners ↔ Runner. 켜기·끄기는 기반의 저장으로, 마지막으로 닿은 때는 version 없이 바로 적는다 (진행 보고의 saveLease처럼).
export class RunnerRepository extends TableRepository<RunnerRow, Runner> {
  protected readonly table = runners;
  protected readonly noun = '러너';

  protected toEntity(row: RunnerRow): Runner {
    return Runner.restore(row);
  }

  /**
   * 러너가 서버에 닿았다 (next_jobs · report_progress). 처음이면 일을 받는 상태로 줄을 만든다.
   * 일을 받는지를 돌려준다. version은 올리지 않는다
   */
  async seen(spaceId: string, deviceId: string, now: Date): Promise<boolean> {
    const [row] = await this.sql<Pick<RunnerRow, 'accepting'>[]>`
      INSERT INTO task.runners (space_id, device_id, last_seen_at)
      VALUES (${spaceId}, ${deviceId}, ${now})
      ON CONFLICT (device_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
      RETURNING accepting`;
    return row?.accepting ?? false;
  }
}
