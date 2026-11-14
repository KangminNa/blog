import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Database,
  Forbidden,
  RuleViolation,
  type Sql,
  SystemActor,
} from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { GoalRepository } from '../goal/goal.repository';
import { SkillQuery } from '../skill/skill.query';
import { TaskRepository } from '../task/task.repository';
import { GoalRound } from './goal-round';
import { GoalRun } from './goal-run';
import type { CreateGoalRunInput, ReportRoundInput } from './goal-run.input';
import { GoalRoundRepository, GoalRunRepository } from './goal-run.repository';

// 목표 실행 쓰기 (기획서 결정 2026-11-13). 실행과 회차 작업 · 결재는 함께 바뀌어야 해서 같은 트랜잭션에서 쓴다 (결재 서비스와 같은 이유).
//   주인: 시작(첫 회차 작업과 함께) · 멈춤(도는 회차 작업 · 하위 작업 · 기다리는 결재를 함께 취소)
//   팀장(작업 토큰): report_round로 회차 보고
//   일꾼: 회차 작업이 끝나면(task.task.changed) 다음을 정하고, 주인이 결재하면(task.approval.*) 다음 회차를 연다
// 잠그는 순서: 작업 → 작업의 결재 → 실행 → 실행의 결재 (모듈 규칙의 작업 → 결재 사이에 실행을 둔다).
@Injectable()
export class GoalRunService extends BaseService {
  constructor(
    db: Database,
    /** 회차 지시의 글 (지시문 틀). 트랜잭션 전에 읽는다 */
    private readonly skills: SkillQuery,
  ) {
    super(db);
  }

  /** 주인이 시작한다: 실행과 첫 회차 작업. 같은 requestId는 처음 만든 실행 */
  async start(actor: Actor, req: CreateGoalRunInput): Promise<GoalRun> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    const prompts = await this.skills.prompts(actor, spaceId);
    return this.transaction(async (tx) => {
      const runs = new GoalRunRepository(tx);
      const before = await runs.findByRequest(spaceId, req.requestId);
      if (before) return before;
      const goal = await new GoalRepository(tx).load(spaceId, req.goalId);
      const lead = await new AgentRepository(tx).load(spaceId, req.agentId);
      const run = GoalRun.open(spaceId, req.requestId, goal, lead, req.fields, now);
      await runs.save(run);
      await new TaskRepository(tx).insertOnce(run.firstRound(prompts, now));
      return run;
    });
  }

  /** 팀장이 회차를 보고한다. 지금 도는 회차의 맨 위 작업만, 회차마다 한 번 */
  async report(actor: Actor, req: ReportRoundInput): Promise<GoalRound> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, taskId } = actor;
    const now = new Date();
    return this.transaction(async (tx) => {
      const task = await new TaskRepository(tx).load(spaceId, taskId);
      const runId = GoalRun.runIdOf(task);
      const round = GoalRun.roundOf(task);
      if (runId === null)
        throw new RuleViolation(
          '목표 실행의 회차 작업이 아니에요 (팀장에게 맡겨진 하위 작업이면 결과로 알려요)',
        );
      const run = await new GoalRunRepository(tx).lock(spaceId, runId);
      run.assertReportable(round);
      const rounds = new GoalRoundRepository(tx);
      if (await rounds.findRound(runId, round))
        throw new RuleViolation('이 회차는 이미 보고했어요');
      const report = GoalRound.report(spaceId, runId, round, task.id, req.fields, now);
      await rounds.save(report);
      return report;
    });
  }

  /** 회차 작업이 끝났다 (일꾼): 결재를 올리거나 다음 회차를 연다. 두 번 불려도 같다 */
  async settleRound(actor: Actor, spaceId: string, taskId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const now = new Date();
    const prompts = await this.skills.prompts(actor, spaceId);
    await this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.load(spaceId, taskId);
      const runId = GoalRun.runIdOf(task);
      const round = GoalRun.roundOf(task);
      if (runId === null || !(task.ended || task.cancelled)) return;
      const runs = new GoalRunRepository(tx);
      const run = await runs.lock(spaceId, runId);
      if (!run.awaits(round)) return;
      const rounds = new GoalRoundRepository(tx);
      const report = await rounds.findRound(runId, round);
      const previous = await rounds.findRound(runId, round - 1);
      const approval = run.closeRound(task, report, previous, now);
      if (approval) await new ApprovalRepository(tx).save(approval);
      else await tasks.insertOnce(run.nextRound(prompts, report, null, now));
      await runs.save(run);
    });
  }

  /** 주인이 실행의 결재를 정했다 (일꾼, task.approval.*): 다음 회차 · 완료 · 멈춤. 두 번 불려도 같다 */
  async decided(actor: Actor, spaceId: string, approvalId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const now = new Date();
    const prompts = await this.skills.prompts(actor, spaceId);
    await this.transaction(async (tx) => {
      const approval = await new ApprovalRepository(tx).findIn(spaceId, approvalId);
      if (approval === null || approval.targetKind !== Approval.GOAL_RUN) return;
      const runs = new GoalRunRepository(tx);
      const run = await runs.lockOrNull(spaceId, approval.targetId);
      if (run === null || !run.decide(approval.action, approval.status, now)) {
        if (run) await runs.save(run);
        return;
      }
      const previous = await new GoalRoundRepository(tx).findRound(run.id, run.round);
      await new TaskRepository(tx).insertOnce(run.nextRound(prompts, previous, approval.note, now));
      await runs.save(run);
    });
  }

  /** 주인이 멈춘다. 도는 회차 작업과 그 하위 작업, 기다리는 결재를 함께 취소한다 */
  async stop(actor: Actor, id: string, version: number): Promise<GoalRun> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const runs = new GoalRunRepository(tx);
      const seen = await runs.load(spaceId, id);
      await this.cancelRound(tx, spaceId, seen, now);
      const run = await runs.lock(spaceId, id);
      run.assertVersion(version);
      run.stop(now);
      const approvals = new ApprovalRepository(tx);
      const pending = await approvals.lockPendingFor(Approval.GOAL_RUN, run.id);
      if (pending) {
        pending.cancel();
        await approvals.save(pending);
      }
      await runs.save(run);
      return run;
    });
  }

  /** 지금 회차 작업이 아직 돌면 하위 작업 · 기다리는 결재까지 취소한다 (작업 → 결재 순서) */
  private async cancelRound(tx: Sql, spaceId: string, run: GoalRun, now: Date): Promise<void> {
    const tasks = new TaskRepository(tx);
    const found = await tasks.findByRequests(spaceId, [run.roundRequestId]);
    const [round] = found;
    if (!round?.open) return;
    const task = await tasks.lock(spaceId, round.id);
    const all = [task, ...(await tasks.lockOpenDescendants(task.id))];
    for (const one of all) {
      if (!one.open) continue;
      one.cancel(now);
      await tasks.save(one);
    }
    const approvals = new ApprovalRepository(tx);
    for (const one of all) {
      const pending = await approvals.lockPending(one.id);
      if (!pending) continue;
      pending.cancel();
      await approvals.save(pending);
    }
  }
}
