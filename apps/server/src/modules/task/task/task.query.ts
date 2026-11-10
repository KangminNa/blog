import { Injectable } from '@nestjs/common';
import { type Actor, AgentActor, BaseQuery, NotFound } from '../../platform';
import { taskRuns, tasks } from '../task.schema';
import type { GoalRow, TaskEventRow, TaskRow } from '../task.tables';
import { Task } from './task';
import type { ListTasksInput, TaskIdInput } from './task.input';
import {
  TaskDetailView,
  TaskEventView,
  TaskGoalView,
  TaskPageView,
  TaskRunView,
  TaskView,
} from './task.view';

// 작업 읽기. 목록과 상세는 주인만. mcp 모듈은 작업 토큰이 아직 살아 있는지 여기에 묻는다.
@Injectable()
export class TaskQuery extends BaseQuery {
  private static readonly PAGE = 30;
  /** 상세 화면에 보내는 실행 기록. 최근 것부터 이만큼 */
  private static readonly EVENTS = 500;
  /** 목록 카드에 보이는 마지막 기록의 길이 */
  private static readonly LAST_EVENT = 200;

  async list(actor: Actor, req: ListTasksInput): Promise<TaskPageView> {
    actor.assertOwner();
    const rows = await this.sql<(TaskRow & { last_event: string | null })[]>`
      SELECT t.*, e.body AS last_event FROM task.tasks t
      LEFT JOIN LATERAL (
        SELECT left(body, ${TaskQuery.LAST_EVENT}) AS body FROM task.task_events
        WHERE task_id = t.id AND body <> '' ORDER BY id DESC LIMIT 1
      ) e ON true
      WHERE t.space_id = ${actor.spaceId}
        ${req.status === null ? this.sql`` : this.sql`AND t.status = ${req.status}`}
        ${req.goalId === null ? this.sql`` : this.sql`AND t.goal_id = ${req.goalId}`}
        ${req.cursor === null ? this.sql`` : this.sql`AND t.id < ${req.cursor}`}
      ORDER BY t.id DESC
      LIMIT ${TaskQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, TaskQuery.PAGE, (last) => last.id);
    return new TaskPageView(
      items.map((r) => new TaskView(r, r.last_event)),
      next,
    );
  }

  async get(actor: Actor, req: TaskIdInput): Promise<TaskDetailView> {
    actor.assertOwner();
    const row = await this.row(tasks, { space_id: actor.requireSpace(), id: req.id });
    if (!row) throw new NotFound('작업을 찾을 수 없어요');
    const events = await this.sql<TaskEventRow[]>`
      SELECT * FROM (
        SELECT * FROM task.task_events WHERE task_id = ${req.id} ORDER BY id DESC LIMIT ${TaskQuery.EVENTS}
      ) e ORDER BY id`;
    const goals = row.goal_id === null ? [] : await this.goalChain(row.goal_id);
    const children = await this.rows(tasks, { parent_id: req.id }, { order: ['id'] });
    const runs = await this.rows(taskRuns, { task_id: req.id }, { order: ['seq'] });
    return new TaskDetailView(
      row,
      Task.shownPayload(row.kind, row.payload),
      events.map((e) => new TaskEventView(e)),
      goals,
      children.map((c) => new TaskView(c)),
      runs.map((r) => new TaskRunView(r)),
    );
  }

  /** 회사 목표부터 이 목표까지. 목표의 부모는 바뀌지 않는다 */
  private async goalChain(goalId: string): Promise<readonly TaskGoalView[]> {
    const rows = await this.sql<Pick<GoalRow, 'id' | 'title' | 'status'>[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, title, status, 0 AS step FROM task.goals WHERE id = ${goalId}
        UNION ALL
        SELECT g.id, g.parent_id, g.title, g.status, up.step + 1 FROM task.goals g
        JOIN up ON g.id = up.parent_id
      )
      SELECT * FROM up ORDER BY step DESC`;
    return rows.map((r) => new TaskGoalView(r));
  }

  /**
   * 이 작업 토큰이 아직 쓸 수 있는가. 작업이 진행 중이거나 결재를 기다리고, 임대가 살아 있어야 한다.
   * 결재를 기다리는 동안은 임대가 남은 만큼만 (응답을 놓친 request_approval을 다시 보낼 수 있게).
   */
  async isLive(actor: Actor): Promise<boolean> {
    if (!(actor instanceof AgentActor)) return false;
    const [row] = await this.sql`
      SELECT 1 FROM task.tasks
      WHERE id = ${actor.taskId} AND agent_id = ${actor.agentId}
        AND status IN (${Task.RUNNING}, ${Task.WAITING}) AND lease_until > now()`;
    return row !== undefined;
  }
}
