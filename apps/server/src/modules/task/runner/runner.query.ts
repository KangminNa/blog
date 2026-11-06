import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, type Row } from '../../platform';
import { Task } from '../task/task';
import { Runner } from './runner';
import { RunnerListView, RunnerTaskView, RunnerView } from './runner.view';

// 러너 읽기. 주인만. 지금 하는 일은 그 러너가 임대를 쥔 실행 중인 작업이다.
@Injectable()
export class RunnerQuery extends BaseQuery {
  async list(actor: Actor): Promise<RunnerListView> {
    actor.assertOwner();
    const now = new Date();
    const rows = await this.sql`
      SELECT r.*, t.id AS task_id, t.title AS task_title
      FROM task.runners r
      LEFT JOIN LATERAL (
        SELECT id, title FROM task.tasks
        WHERE leased_by = r.device_id AND status = ${Task.RUNNING}
        ORDER BY id DESC LIMIT 1
      ) t ON true
      WHERE r.space_id = ${actor.spaceId}
      ORDER BY r.id`;
    return new RunnerListView(rows.map((r) => RunnerQuery.view(r, now)));
  }

  private static view(r: Row, now: Date): RunnerView {
    const lastSeen = new Date(r.last_seen_at);
    return new RunnerView(
      String(r.id),
      String(r.device_id),
      Boolean(r.accepting),
      now.getTime() - lastSeen.getTime() < Runner.ONLINE_MS,
      lastSeen,
      r.task_id ? new RunnerTaskView(String(r.task_id), String(r.task_title)) : null,
      Number(r.version),
    );
  }
}
