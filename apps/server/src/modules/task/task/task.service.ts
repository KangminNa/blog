import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseService,
  ChangeStream,
  Database,
  Forbidden,
  Idempotency,
  SecretBox,
  type Sql,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { AiLoginRepository } from '../ai/ai-login.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { PlanUsage } from '../usage/plan-usage';
import { PlanUsageRepository } from '../usage/plan-usage.repository';
import { Task } from './task';
import type {
  CancelTaskInput,
  CreateTaskInput,
  NextJobsInput,
  ReleaseJobInput,
  ReportProgressInput,
  SubmitResultInput,
} from './task.input';
import { TaskRepository } from './task.repository';
import { JobView, ProgressView } from './task.view';

// 작업 쓰기: 만들기와 취소(주인), 일 요청(이벤트), 빌리기·진행·끝내기·돌려주기(러너), 끝난 임대 되돌리기(일꾼).
// 한도 초과처럼 작업과 함께 바뀌는 에이전트·결재는 같은 트랜잭션에서 쓴다 (객체설계 9장).
// 잠그는 순서는 어디서나 작업 → 결재 → 에이전트.
@Injectable()
export class TaskService extends BaseService {
  private static readonly REPORT = 'report_progress';
  private static readonly SUBMIT = 'submit_result';
  /** 신호를 놓쳤거나 임대가 끝났을 때를 위해 이 간격으로도 다시 찾는다 */
  private static readonly RECHECK_MS = 5_000;
  private static readonly RECLAIM_BATCH = 50;

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly changes: ChangeStream,
  ) {
    super(db);
  }

  /** 콘솔에서 시키는 일. 같은 requestId가 다시 오면 처음 만든 작업을 돌려준다 */
  async create(actor: Actor, req: CreateTaskInput): Promise<Task> {
    actor.assertOwner();
    return this.open(TaskService.spaceOf(actor), req);
  }

  /** 다른 모듈이 이벤트로 요청한 일 (일꾼이 부른다). 같은 이벤트가 두 번 와도 작업은 하나 */
  async request(actor: Actor, spaceId: string, req: CreateTaskInput): Promise<Task> {
    actor.assertCan(Actor.RUN);
    return this.open(spaceId, req);
  }

  /** 러너가 일을 빌린다. 없으면 waitSeconds까지 기다리다가 일이 생기면 바로 돌려준다 (트랜잭션 밖에서 기다린다) */
  async next(actor: Actor, req: NextJobsInput): Promise<readonly JobView[]> {
    actor.assertCan(Actor.RUN);
    const spaceId = TaskService.spaceOf(actor);
    const runnerId = TaskService.runnerOf(actor);
    const deadline = Date.now() + req.waitSeconds * 1000;
    for (;;) {
      const jobs = await this.lease(spaceId, runnerId, req.limit);
      const left = deadline - Date.now();
      if (jobs.length > 0 || left <= 0 || this.changes.closed) return jobs;
      await this.changes.wait(
        (signal) => signal.spaceId === spaceId && signal.topic === Task.CHANGED,
        Math.min(left, TaskService.RECHECK_MS),
      );
    }
  }

  /** 진행 보고: 기록을 남기고 임대를 늘린다. 쓴 토큰은 에이전트의 한 달 한도에 더하고, 러너가 본 구독 사용률을 남긴다 */
  async report(actor: Actor, req: ReportProgressInput): Promise<ProgressView> {
    actor.assertCan(Actor.RUN);
    const spaceId = TaskService.spaceOf(actor);
    const runnerId = TaskService.runnerOf(actor);
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const once =
        req.requestId === null
          ? null
          : new Idempotency(tx, runnerId, req.requestId, TaskService.REPORT);
      const repeated = (await once?.previous()) ?? null;
      const task = await tasks.lock(spaceId, req.taskId);
      if (repeated === null) {
        task.acceptReport(runnerId, now);
        for (const e of req.events) task.log(e.kind, e.body, e.tokens, now);
        await tasks.saveLease(task);
        await this.charge(tx, task, req.tokens, now);
        await this.notePlan(tx, task, req, now);
        await once?.remember({ reported: true });
      }
      return new ProgressView(
        task.status,
        task.cancelled,
        await this.agentPaused(tx, task),
        task.leaseUntil,
      );
    });
  }

  /** 끝내기. 살아 있는 임대로만 된다. 같은 request_id는 처음 결과를 돌려준다 */
  async submit(actor: Actor, req: SubmitResultInput): Promise<Task> {
    actor.assertCan(Actor.RUN);
    const spaceId = TaskService.spaceOf(actor);
    const runnerId = TaskService.runnerOf(actor);
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const once = new Idempotency(tx, runnerId, req.requestId, TaskService.SUBMIT);
      const before = await once.previous();
      if (before) return tasks.load(spaceId, String(before.taskId));
      const task = await tasks.lock(spaceId, req.taskId);
      task.submit(runnerId, req.status, req.result, req.error, now);
      await tasks.save(task);
      await this.noteAiTest(tx, task, now);
      await once.remember({ taskId: task.id });
      return task;
    });
  }

  /** 처리하지 못한 일을 돌려준다 */
  async release(actor: Actor, req: ReleaseJobInput): Promise<Task> {
    actor.assertCan(Actor.RUN);
    const spaceId = TaskService.spaceOf(actor);
    const runnerId = TaskService.runnerOf(actor);
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, req.taskId);
      task.release(runnerId, req.reason, new Date());
      await tasks.save(task);
      return task;
    });
  }

  /** 주인이 멈춘다. 기다리던 결재도 닫는다 */
  async cancel(actor: Actor, req: CancelTaskInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = TaskService.spaceOf(actor);
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, req.id);
      task.assertVersion(req.version);
      task.cancel(new Date());
      await tasks.save(task);
      const approvals = new ApprovalRepository(tx);
      const pending = await approvals.lockPending(task.id);
      if (pending) {
        pending.cancel();
        await approvals.save(pending);
      }
      return task;
    });
  }

  /** 임대가 끝난 작업을 되돌린다 (일꾼이 주기적으로). 되돌린 수를 돌려준다 */
  async reclaim(actor: Actor): Promise<number> {
    actor.assertCan(Actor.RUN);
    return this.transaction((tx) => this.expire(tx, new Date()));
  }

  private open(spaceId: string, req: CreateTaskInput): Promise<Task> {
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      if (req.agentId !== null) await new AgentRepository(tx).load(spaceId, req.agentId);
      const task = Task.open(
        spaceId,
        req.agentId,
        req.kind,
        req.title,
        req.instruction,
        req.payload,
        req.targetKind,
        req.targetId,
        req.baseVersion,
        req.priority,
        req.requestId,
        new Date(),
      );
      return (await tasks.insertOnce(task)) ? task : tasks.findByRequest(spaceId, req.requestId);
    });
  }

  private lease(spaceId: string, runnerId: string, limit: number): Promise<readonly JobView[]> {
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const agents = new AgentRepository(tx);
      await this.expire(tx, now);
      // 쉬는지는 작업을 잠그기 전에 따진다: 쉬는 에이전트의 일은 빌렸다가 돌려주지 않고 처음부터 건너뛴다
      const usage = await agents.usage(spaceId, now);
      const ready = usage.filter((u) => u.ready).map((u) => u.agent);
      const jobs: JobView[] = [];
      for (const task of await tasks.lockNext(spaceId, ready, limit)) {
        // 담당을 정하지 않은 일은 그 일의 권한이 있는 에이전트 중 가장 먼저 만든, 일을 받을 수 있는 에이전트가 맡는다
        const worker = task.agentId
          ? ready.find((a) => a.id === task.agentId)
          : ready.find((a) => task.doableWith(a.scopes));
        const agent = task.isAiTest ? null : worker;
        if (agent === undefined) continue;
        task.lease(runnerId, agent?.id ?? null, now);
        await tasks.save(task);
        jobs.push(this.jobOf(task, agent));
      }
      return jobs;
    });
  }

  private jobOf(task: Task, agent: Agent | null): JobView {
    return new JobView(
      task.id,
      task.kind,
      task.title,
      task.instruction,
      task.payload,
      task.targetKind,
      task.targetId,
      task.baseVersion,
      task.skill,
      task.revisionNote,
      agent?.id ?? null,
      agent?.name ?? null,
      agent?.role ?? null,
      agent?.tool ?? null,
      task.leaseUntil,
      agent && task.actorFor(agent.id, agent.scopes).seal(this.box, Task.RUN_TOKEN_SECONDS),
    );
  }

  private async expire(tx: Sql, now: Date): Promise<number> {
    const tasks = new TaskRepository(tx);
    const expired = await tasks.lockExpired(now, TaskService.RECLAIM_BATCH);
    for (const task of expired) {
      task.expire(now);
      await tasks.save(task);
      await this.noteAiTest(tx, task, now);
    }
    return expired.length;
  }

  /**
   * 연결 확인이 끝나면 결과를 로그인에 남긴다. 러너가 사라져 끝난 확인도 실패로 남긴다.
   * 작업에 적힌 판이 아니면 그사이 토큰을 바꾼 것이다: 옛 토큰의 결과를 새 토큰에 적지 않는다.
   */
  private async noteAiTest(tx: Sql, task: Task, now: Date): Promise<void> {
    if (!task.isAiTest || !task.ended) return;
    const logins = new AiLoginRepository(tx);
    const login = await logins.lock(task.spaceId, String(task.payload.tool));
    if (login === null || login.version !== task.payload.loginVersion) return;
    login.noteTest(task.failure, now);
    await logins.save(login);
  }

  /** 쓴 토큰을 한 달 한도에 더한다. 넘기면 에이전트를 멈추고 한도 올리기 결재를 올린다 */
  private async charge(tx: Sql, task: Task, tokens: number, now: Date): Promise<void> {
    if (tokens === 0 || task.agentId === null) return;
    const agents = new AgentRepository(tx);
    const agent = await agents.lock(task.spaceId, task.agentId);
    const used = await agents.usedThisMonth(agent.id, now);
    if (!agent.overLimit(used)) return;
    agent.pause();
    await agents.save(agent);
    await new ApprovalRepository(tx).save(Approval.raiseLimit(agent, used, now));
  }

  /** 구독 사용률을 남긴다. 어느 도구의 값인지는 러너의 말이 아니라 작업의 에이전트로 정한다. 모르는 창은 뺀다 */
  private async notePlan(tx: Sql, task: Task, req: ReportProgressInput, now: Date): Promise<void> {
    if (req.planUsage.length === 0 || task.agentId === null) return;
    const { tool } = await new AgentRepository(tx).load(task.spaceId, task.agentId);
    const seen = PlanUsage.WINDOWS.flatMap((window) => {
      const last = req.planUsage.findLast((p) => p.window === window);
      return last
        ? [
            PlanUsage.seen(
              task.spaceId,
              tool,
              window,
              last.percent,
              last.resetsAt,
              last.status,
              now,
            ),
          ]
        : [];
    });
    await new PlanUsageRepository(tx).save(seen);
  }

  private async agentPaused(tx: Sql, task: Task): Promise<boolean> {
    if (task.agentId === null) return false;
    return (await new AgentRepository(tx).load(task.spaceId, task.agentId)).paused;
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden(Actor.RUN);
    return actor.spaceId;
  }

  private static runnerOf(actor: Actor): string {
    if (!actor.id) throw new Forbidden(Actor.RUN);
    return actor.id;
  }
}
