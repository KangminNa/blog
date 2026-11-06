import { BaseRepository, type Row } from '../../platform';
import { Heartbeat } from './heartbeat';

// task.heartbeats ↔ Heartbeat. 바뀐 칸만 저장하고 version으로 늦은 쓰기를 막는다.
export class HeartbeatRepository extends BaseRepository<Heartbeat> {
  protected toEntity(row: Row): Heartbeat {
    return Heartbeat.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      String(row.agent_id),
      String(row.mode),
      row.at_minute === null ? null : Number(row.at_minute),
      ((row.weekdays as number[] | null) ?? []).map(Number),
      row.every_hours === null ? null : Number(row.every_hours),
      String(row.time_zone),
      String(row.instruction),
      row.goal_id === null ? null : String(row.goal_id),
      Boolean(row.enabled),
      row.next_run_at === null ? null : new Date(row.next_run_at),
      row.last_run_at === null ? null : new Date(row.last_run_at),
      new Date(row.created_at),
    );
  }

  /** 에이전트의 하트비트를 잠근다. 아직 없으면 null */
  async lockByAgent(spaceId: string, agentId: string): Promise<Heartbeat | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM task.heartbeats
        WHERE space_id = ${spaceId} AND agent_id = ${agentId} FOR UPDATE`,
    );
  }

  /** 때가 된 하트비트를 잠근다 (모든 공간). 다른 일꾼이 잡은 줄은 건너뛴다 */
  async lockDue(now: Date, limit: number): Promise<readonly Heartbeat[]> {
    const rows = await this.sql`
      SELECT * FROM task.heartbeats
      WHERE enabled AND next_run_at <= ${now}
      ORDER BY next_run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }

  async save(heartbeat: Heartbeat): Promise<void> {
    if (heartbeat.isNew) {
      await this.sql`
        INSERT INTO task.heartbeats (id, space_id, agent_id, mode, at_minute, weekdays, every_hours,
          time_zone, instruction, goal_id, enabled, next_run_at, last_run_at, created_at)
        VALUES (${heartbeat.id}, ${heartbeat.spaceId}, ${heartbeat.agentId}, ${heartbeat.mode},
          ${heartbeat.atMinute}, ${heartbeat.weekdays as number[]}, ${heartbeat.everyHours},
          ${heartbeat.timeZone}, ${heartbeat.instruction}, ${heartbeat.goalId}, ${heartbeat.enabled},
          ${heartbeat.nextRunAt}, ${heartbeat.lastRunAt}, ${heartbeat.createdAt})`;
    } else if (heartbeat.changed) {
      const result = await this.sql`
        UPDATE task.heartbeats SET ${this.sql(heartbeat.changes)}, version = version + 1
        WHERE id = ${heartbeat.id} AND version = ${heartbeat.version}`;
      this.expectUpdated(result.count, heartbeat);
    }
    heartbeat.clearChanges();
    await this.publishEvents(heartbeat);
  }
}
