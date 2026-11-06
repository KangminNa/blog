import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, type Row } from '../../platform';
import { Task } from '../task/task';
import { GoalListView, GoalView } from './goal.view';

// 목표 읽기. 주인만. 목표마다 이어진 작업의 수를 함께 센다 (목표별 작업 목록은 GET /api/tasks?goalId=).
@Injectable()
export class GoalQuery extends BaseQuery {
  private static readonly OPEN: readonly string[] = [Task.QUEUED, Task.RUNNING, Task.WAITING];

  async list(actor: Actor): Promise<GoalListView> {
    actor.assertOwner();
    const rows = await this.sql`
      SELECT g.*,
        count(t.id) FILTER (WHERE t.status = ANY(${GoalQuery.OPEN as string[]})) AS open_tasks,
        count(t.id) FILTER (WHERE t.status = ${Task.DONE}) AS done_tasks
      FROM task.goals g
      LEFT JOIN task.tasks t ON t.goal_id = g.id
      WHERE g.space_id = ${actor.spaceId}
      GROUP BY g.id
      ORDER BY g.sort, g.id`;
    return new GoalListView(rows.map((r) => GoalQuery.view(r)));
  }

  private static view(r: Row): GoalView {
    return new GoalView(
      String(r.id),
      r.parent_id === null ? null : String(r.parent_id),
      String(r.title),
      String(r.description),
      String(r.status),
      Number(r.sort),
      Number(r.open_tasks),
      Number(r.done_tasks),
      Number(r.version),
      new Date(r.created_at),
    );
  }
}
