import { Injectable } from '@nestjs/common';
import { type Actor, AgentActor, BaseQuery, NotFound, type Row } from '../../platform';
import { Task } from './task';
import type { ListTasksInput, TaskIdInput } from './task.input';
import { TaskDetailView, TaskEventView, TaskGoalView, TaskPageView, TaskView } from './task.view';

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
    const rows = await this.sql`
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
    const page = rows.slice(0, TaskQuery.PAGE).map((r) => TaskQuery.view(r));
    return new TaskPageView(page, rows.length > TaskQuery.PAGE ? (page.at(-1)?.id ?? null) : null);
  }

  async get(actor: Actor, req: TaskIdInput): Promise<TaskDetailView> {
    actor.assertOwner();
    const [row] = await this.sql`
      SELECT * FROM task.tasks WHERE space_id = ${actor.spaceId} AND id = ${req.id}`;
    if (!row) throw new NotFound('작업을 찾을 수 없어요');
    const events = await this.sql`
      SELECT * FROM (
        SELECT * FROM task.task_events WHERE task_id = ${req.id} ORDER BY id DESC LIMIT ${TaskQuery.EVENTS}
      ) e ORDER BY id`;
    const goals = row.goal_id === null ? [] : await this.goalChain(String(row.goal_id));
    return new TaskDetailView(
      TaskQuery.view(row),
      String(row.instruction),
      row.payload,
      row.result,
      events.map(
        (e) =>
          new TaskEventView(
            String(e.id),
            new Date(e.at),
            String(e.kind),
            String(e.body),
            Number(e.tokens),
          ),
      ),
      goals,
    );
  }

  /** 회사 목표부터 이 목표까지. 목표의 부모는 바뀌지 않는다 */
  private async goalChain(goalId: string): Promise<readonly TaskGoalView[]> {
    const rows = await this.sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, title, status, 0 AS step FROM task.goals WHERE id = ${goalId}
        UNION ALL
        SELECT g.id, g.parent_id, g.title, g.status, up.step + 1 FROM task.goals g
        JOIN up ON g.id = up.parent_id
      )
      SELECT * FROM up ORDER BY step DESC`;
    return rows.map((r) => new TaskGoalView(String(r.id), String(r.title), String(r.status)));
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

  private static view(r: Row): TaskView {
    return new TaskView(
      String(r.id),
      r.agent_id === null ? null : String(r.agent_id),
      String(r.kind),
      String(r.title),
      String(r.status),
      Number(r.priority),
      r.target_kind === null ? null : String(r.target_kind),
      r.target_id === null ? null : String(r.target_id),
      r.base_version === null ? null : Number(r.base_version),
      Number(r.attempts),
      r.lease_until === null ? null : new Date(r.lease_until),
      Number(r.version),
      new Date(r.created_at),
      r.finished_at === null ? null : new Date(r.finished_at),
      r.last_event === undefined || r.last_event === null ? null : String(r.last_event),
      r.goal_id === null ? null : String(r.goal_id),
    );
  }
}
