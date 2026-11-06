import { BaseRepository, type Row } from '../../platform';
import { Runner } from './runner';

// task.runners ↔ Runner. 켜기·끄기는 엔티티로, 마지막으로 닿은 때는 version 없이 바로 적는다 (진행 보고의 saveLease처럼).
export class RunnerRepository extends BaseRepository<Runner> {
  protected toEntity(row: Row): Runner {
    return Runner.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      String(row.device_id),
      Boolean(row.accepting),
      new Date(row.last_seen_at),
    );
  }

  /**
   * 러너가 서버에 닿았다 (next_jobs · report_progress). 처음이면 일을 받는 상태로 줄을 만든다.
   * 일을 받는지를 돌려준다. version은 올리지 않는다
   */
  async seen(spaceId: string, deviceId: string, now: Date): Promise<boolean> {
    const [row] = await this.sql`
      INSERT INTO task.runners (space_id, device_id, last_seen_at)
      VALUES (${spaceId}, ${deviceId}, ${now})
      ON CONFLICT (device_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
      RETURNING accepting`;
    return Boolean(row?.accepting);
  }

  /** 고칠 것을 잠근다. 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<Runner> {
    const rows = await this.sql`
      SELECT * FROM task.runners WHERE id = ${id} AND space_id = ${spaceId} FOR UPDATE`;
    return this.one(rows, '러너');
  }

  async save(runner: Runner): Promise<void> {
    if (runner.changed) {
      const result = await this.sql`
        UPDATE task.runners SET ${this.sql(runner.changes)}, version = version + 1
        WHERE id = ${runner.id} AND version = ${runner.version}`;
      this.expectUpdated(result.count, runner);
    }
    runner.clearChanges();
    await this.publishEvents(runner);
  }
}
