import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  ChangeStream,
  Conflict,
  Database,
  Forbidden,
  Idempotency,
  SecretBox,
  type Sql,
  type VersionInput,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { AiLogin } from '../ai/ai-login';
import { AiLoginRepository } from '../ai/ai-login.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { GoalRepository } from '../goal/goal.repository';
import { OutputQuery } from '../output/output.query';
import { RunnerRepository } from '../runner/runner.repository';
import { RepoSkillGateway } from '../skill/repo-skill.gateway';
import { SkillRepository } from '../skill/skill.repository';
import { SkillPackage } from '../skill/skill-package';
import type { RunnerRow } from '../task.tables';
import { PlanUsage } from '../usage/plan-usage';
import { PlanUsageRepository } from '../usage/plan-usage.repository';
import { CodeScope } from './code-scope';
import { LeasePolicy } from './lease.policy';
import { RunRecord } from './run-record';
import { Task } from './task';
import type {
  CreateTaskInput,
  DelegateTaskInput,
  NextJobsInput,
  ReleaseJobInput,
  ReportProgressInput,
  SubmitResultInput,
} from './task.input';
import { TaskRepository } from './task.repository';
import type { JobView, ProgressView } from './task.view';

// 작업 쓰기: 만들기와 취소(주인), 일 요청(이벤트), 빌리기·진행·끝내기·돌려주기(러너), 끝난 임대 되돌리기(일꾼),
// 위임(에이전트가 작업 토큰으로)과 하위 작업이 끝났을 때 위 작업 깨우기(일꾼).
// 한도 초과처럼 작업과 함께 바뀌는 에이전트·결재는 같은 트랜잭션에서 쓴다 (객체설계 9장).
// 잠그는 순서는 어디서나 작업 → 결재 → 에이전트.
@Injectable()
export class TaskService extends BaseService {
  /** 칸이 일을 빌릴 때 겹쳐서 건너뛸 수 있는 만큼 더 보는 후보 수 */
  private static readonly CODE_LOOKAHEAD = 20;

  private static readonly REPORT = 'report_progress';
  private static readonly SUBMIT = 'submit_result';
  /** 신호를 놓쳤거나 임대가 끝났을 때를 위해 이 간격으로도 다시 찾는다 */
  private static readonly RECHECK_MS = 5_000;
  private static readonly RECLAIM_BATCH = 50;

  constructor(
    db: Database,
    private readonly box: SecretBox,
    private readonly changes: ChangeStream,
    private readonly repoSkills: RepoSkillGateway,
    private readonly outputs: OutputQuery,
  ) {
    super(db);
  }

  /** 콘솔에서 시키는 일. 같은 requestId가 다시 오면 처음 만든 작업을 돌려준다 */
  async create(actor: Actor, req: CreateTaskInput): Promise<Task> {
    actor.assertOwner();
    return this.open(actor, TaskService.spaceOf(actor), req);
  }

  /** 다른 모듈이 이벤트로 요청한 일 (일꾼이 부른다). 같은 이벤트가 두 번 와도 작업은 하나 */
  async request(actor: Actor, spaceId: string, req: CreateTaskInput): Promise<Task> {
    actor.assertCan(Actor.RUN);
    return this.open(actor, spaceId, req);
  }

  /**
   * 러너가 일을 빌린다. 없으면 waitSeconds까지 기다리다가 일이 생기면 바로 돌려준다 (트랜잭션 밖에서 기다린다).
   * 물을 때마다 러너가 닿은 때를 남긴다. 주인이 일 받기를 꺼 둔 러너에게는 빈 목록이다 (러너는 켜진 채로 쉰다)
   */
  async next(actor: Actor, req: NextJobsInput): Promise<readonly JobView[]> {
    actor.assertCan(Actor.RUN);
    const spaceId = TaskService.spaceOf(actor);
    const runnerId = TaskService.runnerOf(actor);
    const deadline = Date.now() + req.waitSeconds * 1000;
    for (;;) {
      const runner = await this.transaction((tx) =>
        new RunnerRepository(tx).seen(spaceId, runnerId, new Date(), actor.inSandbox()),
      );
      const jobs = runner.accepting ? await this.lease(actor, runner, req) : [];
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
      // 다시 보낸 보고도 이 러너가 맡았던 일이어야 한다: 남겨 둔 결과에는 작업 id가 없어서,
      // 확인하지 않으면 옛 request_id에 남의 작업 id를 붙여 그 작업의 상태를 볼 수 있다
      task.assertWorkedBy(runnerId);
      if (repeated === null) {
        task.acceptReport(runnerId, now);
        for (const e of req.events) task.log(e.kind, e.body, e.tokens, now);
        await tasks.saveLease(task);
        if (req.model !== null) await tasks.noteModel(task.id, runnerId, req.model);
        await this.charge(tx, task, req.tokens, now);
        await this.notePlan(tx, task, req, now);
        await once?.remember({ reported: true });
      }
      // 일하는 동안에는 next_jobs를 부르지 않으므로 진행 보고로 닿은 때를 남긴다 (잠그는 순서의 맨 뒤)
      await new RunnerRepository(tx).seen(spaceId, runnerId, now, actor.inSandbox());
      return task.progressView(await this.agentPaused(tx, task));
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
      task.submit(runnerId, req.status, req.result, req.error, now, await tasks.madeBy(task));
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

  /** 주인이 멈춘다. 기다리던 결재도 닫고, 끝나지 않은 아래 작업(위임)도 함께 멈춘다 */
  async cancel(actor: Actor, req: VersionInput): Promise<Task> {
    actor.assertOwner();
    const spaceId = TaskService.spaceOf(actor);
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.lock(spaceId, req.id);
      task.assertVersion(req.version);
      // 잠그는 순서는 위 작업 → 아래 작업 → 결재
      const below = await tasks.lockOpenDescendants(task.id);
      for (const one of [task, ...below]) {
        one.cancel(now);
        await tasks.save(one);
      }
      const approvals = new ApprovalRepository(tx);
      for (const one of [task, ...below]) {
        const pending = await approvals.lockPending(one.id);
        if (!pending) continue;
        pending.cancel();
        await approvals.save(pending);
      }
      return task;
    });
  }

  /**
   * 에이전트가 바로 아래 팀에게 하위 작업을 맡긴다 (delegate_task). 작업은 하위 작업을 기다리고,
   * 러너는 결재 대기처럼 AI를 끄고 제출하지 않는다. 같은 request_id들로 다시 보내면 처음 만든 하위 작업을 돌려준다.
   */
  async delegate(actor: Actor, req: DelegateTaskInput): Promise<readonly Task[]> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId) throw new Forbidden(Actor.AGENT);
    const { spaceId, agentId, taskId } = actor;
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parent = await tasks.lock(spaceId, taskId);
      const keys = req.subtasks.map((s) => parent.subtaskRequestId(s.requestId));
      const before = await tasks.findByRequests(spaceId, keys);
      if (before.length > 0) {
        // 응답을 놓쳐 같은 호출을 다시 보냈다: 그때 만든 것을 그대로. 일부만 겹치면 다른 호출이다
        if (before.length === keys.length)
          return keys.map((k) => before.find((t) => t.requestId === k) as Task);
        throw new Conflict('이미 쓴 request_id예요. 새 하위 작업에는 새 request_id를 써 주세요');
      }
      const siblings = await tasks.children(parent.id);
      parent.assertCanDelegate(agentId, req.subtasks.length, siblings.length, now);
      const org = await new AgentRepository(tx).all(spaceId);
      const manager = org.find((a) => a.id === agentId);
      if (!manager) throw new Forbidden(Actor.AGENT);
      const made = req.subtasks.map((s) =>
        parent.subtask(
          manager,
          org.find((a) => a.id === s.toAgentId) ?? null,
          s.requestId,
          s.fields,
          s.paths,
          now,
        ),
      );
      // 코드 하위 작업끼리(아직 안 끝난 형제 포함) 고칠 곳이 겹치면 PR이 부딪친다
      CodeScope.assertApart(
        [...siblings.filter((t) => t.open), ...made].flatMap((t) => t.codeScope ?? []),
      );
      for (const child of made)
        if (!(await tasks.insertOnce(child)))
          throw new Conflict('같은 하위 작업이 동시에 만들어졌어요. 다시 보내 주세요');
      parent.waitForSubtasks(made.length, now);
      await tasks.save(parent);
      return made;
    });
  }

  /**
   * 하위 작업 하나가 끝났다 (일꾼이 task.task.changed로 부른다). 형제가 모두 끝났으면 위 작업을 대기열로 돌린다.
   * 위 작업만 잠그고 세므로, 둘이 동시에 끝나도 늦게 커밋한 쪽이 깨운다. 두 번 불려도 같다
   */
  async settleSubtask(actor: Actor, taskId: string): Promise<void> {
    actor.assertCan(Actor.RUN);
    await this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const parentId = await tasks.parentOf(taskId);
      if (parentId === null) return;
      const parent = await tasks.lockById(parentId);
      if (!parent?.waitingForSubtasks) return;
      if ((await tasks.openChildren(parent.id)) > 0) return;
      parent.wakeAfterSubtasks(new Date());
      await tasks.save(parent);
    });
  }

  /** 임대가 끝난 작업을 되돌린다 (일꾼이 주기적으로). 되돌린 수를 돌려준다 */
  async reclaim(actor: Actor): Promise<number> {
    actor.assertCan(Actor.RUN);
    return this.transaction((tx) => this.expire(tx, new Date()));
  }

  private async open(actor: Actor, spaceId: string, req: CreateTaskInput): Promise<Task> {
    const task = Task.open(spaceId, req.requestId, req.fields, new Date());
    // 만들기의 재료 결과물은 트랜잭션 밖에서 미리 본다. 그사이 휴지통에 가면 러너가 받을 때 빼고 기록한다
    const materials = task.makeMaterials;
    if (materials !== null && materials.outputs.length > 0)
      materials.assertLive(await this.outputs.liveIds(actor, spaceId, materials.outputs));
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const { agent_id: agentId = null, goal_id: goalId = null } = req.fields;
      if (agentId !== null) await new AgentRepository(tx).load(spaceId, agentId);
      // 목표는 진행 중이어야 한다. 잠그지 않는다: 그사이 끝나도 이어진 작업은 그대로 가는 것과 같다
      if (goalId !== null) (await new GoalRepository(tx).load(spaceId, goalId)).assertActive();
      return (await tasks.insertOnce(task)) ? task : tasks.findByRequest(spaceId, req.requestId);
    });
  }

  /** runner: 빌리는 러너의 줄 (기기 id · 칸인지 · 묶인 에이전트를 가를 id) */
  private lease(actor: Actor, runner: RunnerRow, req: NextJobsInput): Promise<readonly JobView[]> {
    const { space_id: spaceId, device_id: runnerId, sandbox } = runner;
    const now = new Date();
    return this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const agents = new AgentRepository(tx);
      await this.expire(tx, now);
      // 러너가 할 수 있는 일만: 가진 CLI와 쓸 수 있는 로그인 (LeasePolicy). 빌렸다가 돌려주지 않는다
      const usable = await new AiLoginRepository(tx).usableTools(spaceId, now);
      const running = await tasks.runningAgentTools(spaceId);
      const workTools = LeasePolicy.workTools(
        req.tools,
        req.ownLogins,
        usable,
        AiLogin.ROTATING,
        running,
      );
      // 쉬는지는 작업을 잠그기 전에 따진다: 쉬는 에이전트의 일은 빌렸다가 돌려주지 않고 처음부터 건너뛴다
      const usage = await agents.usage(spaceId, now);
      // 다른 러너에 묶인 에이전트의 일은 이 러너가 빌리지 않는다 (자동 배정도 그 에이전트를 고르지 않는다)
      const ready = usage
        .filter((u) => u.ready && u.agent.runsOn(runner.id))
        .filter((u) => workTools === null || workTools.includes(u.agent.tool))
        .map((u) => u.agent);
      const org = usage.map((u) => u.agent);
      const jobs: JobView[] = [];
      // 칸: 공간을 잠그고(두 칸이 동시에 겹치는 일을 받지 않게) 저장소를 쥔 code 작업과 겹치는 일은 건너뛴다.
      // 건너뛸 수 있으니 후보를 넉넉히 잠근다
      if (sandbox) await tasks.lockCodeLeasing(spaceId);
      const held = sandbox
        ? (await tasks.holdingCode(spaceId)).flatMap((t) => t.codeScope ?? [])
        : [];
      const look = sandbox ? req.limit + TaskService.CODE_LOOKAHEAD : req.limit;
      const picked = await tasks.lockNext(spaceId, ready, look, {
        testTools: LeasePolicy.testTools(req.tools, usable),
        signinTools: req.signinTools,
        browser: req.browser,
        sandbox,
      });
      const busy = [...running];
      for (const task of picked) {
        if (jobs.length >= req.limit) break;
        const scope = task.codeScope;
        if (scope && held.some((h) => h.overlaps(scope))) continue;
        // 담당을 정하지 않은 일은 그 일의 권한이 있는 에이전트 중 가장 먼저 만든, 일을 받을 수 있는 에이전트가 맡는다
        const worker = task.agentId
          ? ready.find((a) => a.id === task.agentId)
          : ready.find((a) => task.doableWith(a.scopes));
        const agent = task.agentless ? null : worker;
        if (agent === undefined) continue;
        if (agent && !LeasePolicy.canStart(agent.tool, req.ownLogins, AiLogin.ROTATING, busy))
          continue;
        if (agent) busy.push(agent.tool);
        if (scope) held.push(scope);
        task.lease(runnerId, agent?.id ?? null, now);
        const skill = await this.skillOf(tx, task);
        const tool = agent?.tool ?? task.payloadTool;
        const cli = tool === null ? null : (req.cliVersions.get(tool) ?? null);
        task.recordRun(runnerId, new RunRecord(agent ?? null, skill, req.runnerBuild, cli), now);
        await tasks.save(task);
        jobs.push(await this.jobOf(actor, tx, task, agent, org, skill));
      }
      return jobs;
    });
  }

  /**
   * 빌려 준 일 하나. 목표 사슬, 바로 아래 팀, 깨어난 일이면 하위 작업의 결과와 그 결과물, 스킬의 지금 판을 함께 싣는다
   */
  private async jobOf(
    actor: Actor,
    tx: Sql,
    task: Task,
    agent: Agent | null,
    org: readonly Agent[],
    skill: SkillPackage | null,
  ): Promise<JobView> {
    const goals = task.goalId === null ? [] : await new GoalRepository(tx).chain(task.goalId);
    const children = await new TaskRepository(tx).children(task.id);
    const ids = children.map((c) => c.id);
    const made = await this.outputs.madeBy(actor, ids);
    const view = task.jobView(agent, this.box, goals, org, children, skill?.jobView() ?? null);
    return view.withOutputs(made);
  }

  /** 스킬의 지금 판: 주인이 콘솔에서 고친 판이 있으면 그것, 없으면 서버 이미지의 저장소 판 (러너는 이것으로 깐다) */
  private async skillOf(tx: Sql, task: Task): Promise<SkillPackage | null> {
    const name = task.skill;
    if (name === null) return null;
    const active = await new SkillRepository(tx).activeRevision(task.spaceId, name);
    return SkillPackage.pick(name, active, this.repoSkills.get(name));
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
    const login = await logins.lockTool(task.spaceId, task.testedTool);
    if (login === null || !task.tests(login.version)) return;
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
      const last = req.planUsage.findLast((p) => p.fields.period === window);
      return last ? [PlanUsage.seen(task.spaceId, tool, last.fields, now)] : [];
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
