import { TableRepository } from '../../platform';
import type { HeartbeatRow } from '../task.tables';
import { Heartbeat } from './heartbeat';

// task.heartbeats ↔ Heartbeat. 저장은 기반이 하고(바뀐 칸만, version으로 늦은 쓰기를 막는다), 여기에는 찾는 SQL만 있다.
export class HeartbeatRepository extends TableRepository<HeartbeatRow, Heartbeat> {
  protected readonly table = 'task.heartbeats';
  protected readonly noun = '하트비트';

  protected toEntity(row: HeartbeatRow): Heartbeat {
    return Heartbeat.restore(row);
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
    const rows = await this.sql<HeartbeatRow[]>`
      SELECT * FROM task.heartbeats
      WHERE enabled AND next_run_at <= ${now}
      ORDER BY next_run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }
}
