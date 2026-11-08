import { BaseRepository, ChangeSignal, eq, QueryTemplate } from '../../platform';
import { planUsage } from '../task.schema';
import type { PlanUsageRow } from '../task.tables';
import { PlanUsage } from './plan-usage';

// task.plan_usage ↔ PlanUsage. 창마다 마지막 값 하나만 둔다.
export class PlanUsageRepository extends BaseRepository<PlanUsage> {
  /** 구독 사용률이 바뀌었다는 신호 (콘솔의 사용량이 다시 읽는다). 이벤트가 아니라 받는 모듈이 없다 */
  static readonly CHANGED = 'task.usage.changed';
  /** 공간의 구독 사용률 전부 (도구와 창마다 한 줄) */
  private static readonly ALL = QueryTemplate.of<{ space: string }, PlanUsageRow>((q) =>
    q
      .select()
      .from(planUsage)
      .where(eq(planUsage.space_id, QueryTemplate.value('space'))),
  );

  protected toEntity(row: PlanUsageRow): PlanUsage {
    return PlanUsage.restore(row);
  }

  async list(spaceId: string): Promise<readonly PlanUsage[]> {
    const rows = await PlanUsageRepository.ALL.rows(this.sql, { space: spaceId });
    return rows.map((r) => this.toEntity(r));
  }

  /** 도구 하나의 창들을 새 값으로 바꾼다. 부르는 쪽의 트랜잭션에서 저장하고 신호를 보낸다 */
  async save(seen: readonly PlanUsage[]): Promise<void> {
    const first = seen[0];
    if (!first) return;
    await this.sql`
      INSERT INTO task.plan_usage ${this.sql(seen.map((p) => p.unsaved) as never)}
      ON CONFLICT (space_id, tool, period) DO UPDATE
      SET percent = EXCLUDED.percent, resets_at = EXCLUDED.resets_at,
        status = EXCLUDED.status, seen_at = EXCLUDED.seen_at`;
    await ChangeSignal.send(this.sql, [
      new ChangeSignal(first.spaceId, PlanUsageRepository.CHANGED, first.tool),
    ]);
  }
}
