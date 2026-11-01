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
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
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

  /** 진행 보고: 기록을 남기고 임대를 늘린다. 쓴 토큰은 에이전트의 한 달 한도에 더한다 */
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
        task.log(req.kind, req.body, req.tokens, now);
        await tasks.saveLease(task);
        await this.charge(tx, task, req.tokens, now);
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
      task.submit(runnerId, req.result, req.error, now);
      await tasks.save(task);
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
      task.release(runnerId, new Date());
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
    return this.transaction((tx) => this.expire(new TaskRepository(tx), new Date()));
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
      await this.expire(tasks, now);
      const jobs: JobView[] = [];
      for (const task of await tasks.lockNext(spaceId, limit)) {
        const agent = task.agentId
          ? await agents.load(spaceId, task.agentId)
          : await agents.firstActive(spaceId);
        if (!agent) continue;
        task.lease(runnerId, agent.id, now);
        await tasks.save(task);
        jobs.push(this.jobOf(task, agent));
      }
      return jobs;
    });
  }

  private jobOf(task: Task, agent: Agent): JobView {
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
      agent.id,
      agent.name,
      agent.role,
      agent.tool,
      task.leaseUntil,
      task.actorFor(agent.id, agent.scopes).seal(this.box, Task.RUN_TOKEN_SECONDS),
    );
  }

  private async expire(tasks: TaskRepository, now: Date): Promise<number> {
    const expired = await tasks.lockExpired(now, TaskService.RECLAIM_BATCH);
    for (const task of expired) {
      task.expire(now);
      await tasks.save(task);
    }
    return expired.length;
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
