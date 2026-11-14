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
   * 러너가 서버에 닿았다 (next_jobs · report_progress · ai_login · ai_signin). 처음이면 일을 받는 상태로 줄을 만든다.
   * 칸인지(sandbox)는 러너가 알리는 값이 아니라 기기의 권한이라 늘 덮어쓴다. 줄을 돌려준다 (일 받기 · 묶기에 쓴다).
   * version은 올리지 않는다
   */
  async seen(spaceId: string, deviceId: string, now: Date, sandbox: boolean): Promise<RunnerRow> {
    const [row] = await this.sql<RunnerRow[]>`
      INSERT INTO task.runners (space_id, device_id, last_seen_at, sandbox)
      VALUES (${spaceId}, ${deviceId}, ${now}, ${sandbox})
      ON CONFLICT (device_id) DO UPDATE
        SET last_seen_at = EXCLUDED.last_seen_at, sandbox = EXCLUDED.sandbox
      RETURNING *`;
    if (!row) throw new Error('러너 줄을 남기지 못했어요');
    return row;
  }
}
