import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound } from '../../platform';
import { Approval } from '../approval/approval';
import type { GoalRoundRow, GoalRunRow } from '../task.tables';
import type { GoalRunIdInput, ListGoalRunsInput } from './goal-run.input';
import { GoalRunDetailView, GoalRunListView, GoalRunView } from './goal-run.view';

// 목표 실행 읽기 (주인만). 목록은 목표 제목 · 팀장 이름과 함께, 상세는 회차 보고 전부와 기다리는 결재까지.
@Injectable()
export class GoalRunQuery extends BaseQuery {
  private static readonly PAGE = 50;

  async list(actor: Actor, req: ListGoalRunsInput): Promise<GoalRunListView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const rows = await this.sql<(GoalRunRow & { goal_title: string; agent_name: string })[]>`
      SELECT r.*, g.title AS goal_title, a.name AS agent_name FROM task.goal_runs r
      JOIN task.goals g ON g.id = r.goal_id
      JOIN task.agents a ON a.id = r.agent_id
      WHERE r.space_id = ${spaceId}
        ${req.goalId === null ? this.sql`` : this.sql`AND r.goal_id = ${req.goalId}`}
      ORDER BY r.id DESC LIMIT ${GoalRunQuery.PAGE}`;
    return new GoalRunListView(rows.map((r) => new GoalRunView(r, r.goal_title, r.agent_name)));
  }

  async get(actor: Actor, req: GoalRunIdInput): Promise<GoalRunDetailView> {
    actor.assertOwner();
    const { id } = req;
    const spaceId = actor.requireSpace();
    const [run] = await this.sql<(GoalRunRow & { goal_title: string; agent_name: string })[]>`
      SELECT r.*, g.title AS goal_title, a.name AS agent_name FROM task.goal_runs r
      JOIN task.goals g ON g.id = r.goal_id
      JOIN task.agents a ON a.id = r.agent_id
      WHERE r.space_id = ${spaceId} AND r.id = ${id}`;
    if (!run) throw new NotFound('목표 실행을 찾을 수 없어요');
    const rounds = await this.sql<GoalRoundRow[]>`
      SELECT * FROM task.goal_rounds WHERE run_id = ${id} ORDER BY round`;
    const [pending] = await this.sql<{ id: string }[]>`
      SELECT id FROM task.approvals
      WHERE space_id = ${spaceId} AND target_kind = ${Approval.GOAL_RUN} AND target_id = ${id}
        AND status = ${Approval.PENDING}
      LIMIT 1`;
    return new GoalRunDetailView(
      new GoalRunView(run, run.goal_title, run.agent_name),
      rounds,
      pending?.id ?? null,
    );
  }
}
