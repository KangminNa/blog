import { BaseRepository, ChangeSignal, type Row } from '../../platform';
import { PlanUsage } from './plan-usage';

// task.plan_usage ↔ PlanUsage. 창마다 마지막 값 하나만 둔다.
export class PlanUsageRepository extends BaseRepository<PlanUsage> {
  /** 구독 사용률이 바뀌었다는 신호 (콘솔의 사용량이 다시 읽는다). 이벤트가 아니라 받는 모듈이 없다 */
  static readonly CHANGED = 'task.usage.changed';

  protected toEntity(row: Row): PlanUsage {
    return PlanUsage.restore(
      String(row.space_id),
      String(row.tool),
      String(row.period),
      Number(row.percent),
      new Date(row.resets_at),
      row.status === null ? null : String(row.status),
      new Date(row.seen_at),
    );
  }

  async list(spaceId: string): Promise<readonly PlanUsage[]> {
    const rows = await this.sql`SELECT * FROM task.plan_usage WHERE space_id = ${spaceId}`;
    return rows.map((r) => this.toEntity(r));
  }

  /** 도구 하나의 창들을 새 값으로 바꾼다. 부르는 쪽의 트랜잭션에서 저장하고 신호를 보낸다 */
  async save(seen: readonly PlanUsage[]): Promise<void> {
    const first = seen[0];
    if (!first) return;
    const rows = seen.map((p) => ({
      space_id: p.spaceId,
      tool: p.tool,
      period: p.window,
      percent: p.percent,
      resets_at: p.resetsAt,
      status: p.status,
      seen_at: p.seenAt,
    }));
    await this.sql`
      INSERT INTO task.plan_usage ${this.sql(rows, 'space_id', 'tool', 'period', 'percent', 'resets_at', 'status', 'seen_at')}
      ON CONFLICT (space_id, tool, period) DO UPDATE
      SET percent = EXCLUDED.percent, resets_at = EXCLUDED.resets_at,
        status = EXCLUDED.status, seen_at = EXCLUDED.seen_at`;
    await ChangeSignal.send(this.sql, [
      new ChangeSignal(first.spaceId, PlanUsageRepository.CHANGED, first.tool),
    ]);
  }
}
