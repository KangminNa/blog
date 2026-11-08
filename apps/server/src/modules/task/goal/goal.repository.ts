import { TableRepository } from '../../platform';
import { goals } from '../task.schema';
import type { GoalRow } from '../task.tables';
import { Goal } from './goal';

// task.goals ↔ Goal. 불러오기와 저장은 기반이 하고, 여기에는 나무를 따라가는 SQL만 있다.
export class GoalRepository extends TableRepository<GoalRow, Goal> {
  protected readonly table = goals;
  protected readonly noun = '목표';

  protected toEntity(row: GoalRow): Goal {
    return Goal.restore(row);
  }

  /**
   * 목표가 몇 단계에 있는지 (맨 위가 1). 부모는 바뀌지 않으므로 잠그지 않고 센다.
   * 깊이 한도보다 깊이 따라가지 않는다.
   */
  async depthOf(id: string): Promise<number> {
    const [row] = await this.sql<{ depth: number | null }[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 1 AS depth FROM task.goals WHERE id = ${id}
        UNION ALL
        SELECT g.id, g.parent_id, up.depth + 1 FROM task.goals g
        JOIN up ON g.id = up.parent_id
        WHERE up.depth <= ${Goal.DEPTH_MAX}
      )
      SELECT max(depth) AS depth FROM up`;
    return row?.depth ?? 0;
  }

  /** 회사 목표부터 이 목표까지. 부모는 바뀌지 않아 잠그지 않는다 */
  async chain(id: string): Promise<readonly Goal[]> {
    const rows = await this.sql<GoalRow[]>`
      WITH RECURSIVE up AS (
        SELECT g.*, 0 AS step FROM task.goals g WHERE id = ${id}
        UNION ALL
        SELECT g.*, up.step + 1 FROM task.goals g JOIN up ON g.id = up.parent_id
      )
      SELECT * FROM up ORDER BY step DESC`;
    return rows.map((r) => this.toEntity(r));
  }
}
