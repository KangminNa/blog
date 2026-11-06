import { BaseRepository, type Row } from '../../platform';
import { Goal } from './goal';

// task.goals ↔ Goal. 바뀐 칸만 저장하고 version으로 늦은 쓰기를 막는다.
export class GoalRepository extends BaseRepository<Goal> {
  protected toEntity(row: Row): Goal {
    return Goal.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      row.parent_id === null ? null : String(row.parent_id),
      String(row.title),
      String(row.description),
      String(row.status),
      Number(row.sort),
      new Date(row.created_at),
    );
  }

  /** 없으면 NotFound */
  async load(spaceId: string, id: string): Promise<Goal> {
    const rows = await this.sql`
      SELECT * FROM task.goals WHERE id = ${id} AND space_id = ${spaceId}`;
    return this.one(rows, '목표');
  }

  /** 고칠 것을 잠근다. 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<Goal> {
    const rows = await this.sql`
      SELECT * FROM task.goals WHERE id = ${id} AND space_id = ${spaceId} FOR UPDATE`;
    return this.one(rows, '목표');
  }

  /**
   * 목표가 몇 단계에 있는지 (맨 위가 1). 부모는 바뀌지 않으므로 잠그지 않고 센다.
   * 깊이 한도보다 깊이 따라가지 않는다.
   */
  async depthOf(id: string): Promise<number> {
    const [row] = await this.sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 1 AS depth FROM task.goals WHERE id = ${id}
        UNION ALL
        SELECT g.id, g.parent_id, up.depth + 1 FROM task.goals g
        JOIN up ON g.id = up.parent_id
        WHERE up.depth <= ${Goal.DEPTH_MAX}
      )
      SELECT max(depth) AS depth FROM up`;
    return Number(row?.depth ?? 0);
  }

  /** 회사 목표부터 이 목표까지. 부모는 바뀌지 않아 잠그지 않는다 */
  async chain(id: string): Promise<readonly Goal[]> {
    const rows = await this.sql`
      WITH RECURSIVE up AS (
        SELECT g.*, 0 AS step FROM task.goals g WHERE id = ${id}
        UNION ALL
        SELECT g.*, up.step + 1 FROM task.goals g JOIN up ON g.id = up.parent_id
      )
      SELECT * FROM up ORDER BY step DESC`;
    return rows.map((r) => this.toEntity(r));
  }

  async save(goal: Goal): Promise<void> {
    if (goal.isNew) {
      await this.sql`
        INSERT INTO task.goals (id, space_id, parent_id, title, description, status, sort, created_at)
        VALUES (${goal.id}, ${goal.spaceId}, ${goal.parentId}, ${goal.title}, ${goal.description},
          ${goal.status}, ${goal.sort}, ${goal.createdAt})`;
    } else if (goal.changed) {
      const result = await this.sql`
        UPDATE task.goals SET ${this.sql(goal.changes)}, version = version + 1
        WHERE id = ${goal.id} AND version = ${goal.version}`;
      this.expectUpdated(result.count, goal);
    }
    goal.clearChanges();
    await this.publishEvents(goal);
  }
}
