import { and, asc, eq, lte, QueryTemplate, TableRepository } from '../../platform';
import { heartbeats } from '../task.schema';
import type { HeartbeatRow } from '../task.tables';
import { Heartbeat } from './heartbeat';

// task.heartbeats ↔ Heartbeat. 저장은 기반이 하고(바뀐 칸만, version으로 늦은 쓰기를 막는다), 여기에는 찾는 SQL만 있다.
export class HeartbeatRepository extends TableRepository<HeartbeatRow, Heartbeat> {
  /** 공간에서 에이전트의 하트비트를 잠근다 (에이전트마다 한 줄) */
  private static readonly LOCK_BY_AGENT = QueryTemplate.of<
    { space: string; agent: string },
    HeartbeatRow
  >((q) =>
    q
      .select()
      .from(heartbeats)
      .where(
        and(
          eq(heartbeats.space_id, QueryTemplate.value('space')),
          eq(heartbeats.agent_id, QueryTemplate.value('agent')),
        ),
      )
      .for('update'),
  );
  /** 켜져 있고 때가 된 하트비트를 때 순서로 잠근다 (모든 공간). 다른 쪽이 잡은 줄은 건너뛴다 */
  private static readonly LOCK_DUE = QueryTemplate.of<{ now: Date; limit: number }, HeartbeatRow>(
    (q) =>
      q
        .select()
        .from(heartbeats)
        .where(
          // 칸 자체를 조건으로 (enabled = $1이 아니라): 부분 색인 heartbeats_due_idx(WHERE enabled)를 쓰게
          and(heartbeats.enabled, lte(heartbeats.next_run_at, QueryTemplate.value('now'))),
        )
        .orderBy(asc(heartbeats.next_run_at))
        .limit(QueryTemplate.value('limit'))
        .for('update', { skipLocked: true }),
  );

  protected readonly table = heartbeats;
  protected readonly noun = '하트비트';

  protected toEntity(row: HeartbeatRow): Heartbeat {
    return Heartbeat.restore(row);
  }

  /** 에이전트의 하트비트를 잠근다. 아직 없으면 null */
  async lockByAgent(spaceId: string, agentId: string): Promise<Heartbeat | null> {
    return this.maybeOne(
      await HeartbeatRepository.LOCK_BY_AGENT.rows(this.sql, { space: spaceId, agent: agentId }),
    );
  }

  /** 때가 된 하트비트를 잠근다 (모든 공간). 다른 일꾼이 잡은 줄은 건너뛴다 */
  async lockDue(now: Date, limit: number): Promise<readonly Heartbeat[]> {
    const rows = await HeartbeatRepository.LOCK_DUE.rows(this.sql, { now, limit });
    return rows.map((r) => this.toEntity(r));
  }
}
