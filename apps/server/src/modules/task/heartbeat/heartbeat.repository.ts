import { TableRepository } from '../../platform';
import { heartbeats } from '../task.schema';
import type { HeartbeatRow } from '../task.tables';
import { Heartbeat } from './heartbeat';

// task.heartbeats ↔ Heartbeat. 저장은 기반이 하고(바뀐 칸만, version으로 늦은 쓰기를 막는다), 여기에는 찾는 SQL만 있다.
export class HeartbeatRepository extends TableRepository<HeartbeatRow, Heartbeat> {
  protected readonly table = heartbeats;
  protected readonly noun = '하트비트';

  protected toEntity(row: HeartbeatRow): Heartbeat {
    return Heartbeat.restore(row);
  }

  /** 에이전트의 하트비트를 잠근다 (에이전트마다 한 줄). 아직 없으면 null */
  async lockByAgent(spaceId: string, agentId: string): Promise<Heartbeat | null> {
    return this.findOne({ space_id: spaceId, agent_id: agentId }, { lock: true });
  }

  /** 켜져 있고 때가 된 하트비트를 때 순서로 잠근다 (모든 공간). 다른 일꾼이 잡은 줄은 건너뛴다 */
  async lockDue(now: Date, limit: number): Promise<readonly Heartbeat[]> {
    // 칸 자체를 조건으로: 조건 규칙의 enabled = $1은 일반 계획에서 부분 색인 heartbeats_due_idx(WHERE enabled)를 못 쓴다
    const rows = await this.sql<HeartbeatRow[]>`
      SELECT * FROM task.heartbeats WHERE enabled AND next_run_at <= ${now}
      ORDER BY next_run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
    return rows.map((r) => this.toEntity(r));
  }
}
