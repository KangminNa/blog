import {
  Actor,
  AgentActor,
  BaseEntity,
  DomainEvent,
  RuleViolation,
  type SecretBox,
  TableEntity,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AiTestView } from '../ai/ai-login.view';
import type { TaskEventRow, TaskNew, TaskRow } from '../task.tables';
import { JobStateView, JobView, ProgressView, TaskView } from './task.view';

// 작업 하나. 러너가 임대로 빌려 가고, 에이전트가 결재를 올리고, 결재 뒤 실행 결과로 끝난다.
//   queued → running → waiting → running → done, 그리고 failed · cancelled
// 상태는 아래 메서드로만 바꾼다. 허용되지 않은 변경은 RuleViolation.
// 실행 기록(task_events)은 추가만 하고 작업과 함께 저장한다.
export class Task extends TableEntity<TaskRow, TaskNew> {
  static readonly QUEUED = 'queued';
  static readonly RUNNING = 'running';
  static readonly WAITING = 'waiting';
  static readonly DONE = 'done';
  static readonly FAILED = 'failed';
  static readonly CANCELLED = 'cancelled';
  /** 어느 모듈이든 일을 요청하는 이벤트 */
  static readonly REQUESTED = 'task.task.requested';
  /** 상태가 바뀔 때마다. 러너의 긴 폴링과 콘솔이 이것으로 깨어난다 */
  static readonly CHANGED = 'task.task.changed';
  /** 임대 15분. report_progress가 늘린다 */
  static readonly LEASE_MS = 15 * 60_000;
  /** 임대가 이만큼 끝나면 실패로 둔다 */
  static readonly MAX_ATTEMPTS = 3;
  /**
   * 작업 토큰의 상한. AI CLI는 처음 받은 토큰을 바꿔 끼울 수 없어서, 임대가 늘어도 끊기지 않게 넉넉히 둔다.
   * 실제 만료는 임대다: mcp 모듈이 호출마다 임대가 살아 있는지 묻는다.
   */
  static readonly RUN_TOKEN_SECONDS = 24 * 60 * 60;
  /** AI 로그인 연결 확인. 에이전트도 작업 토큰도 없이 러너가 돌린다 */
  static readonly AI_TEST = 'ai_test';
  /** 실행 기록의 종류 */
  static readonly LOG_WRITE = 'write';
  private static readonly LOG_RESULT = 'result';
  private static readonly LOG_ERROR = 'error';
  private static readonly LOG_KINDS: readonly string[] = [
    'read',
    Task.LOG_WRITE,
    Task.LOG_RESULT,
    Task.LOG_ERROR,
  ];
  /** 연결 확인은 쌓인 일보다 먼저 돈다 */
  private static readonly AI_TEST_PRIORITY = 1000;
  private static readonly AI_TEST_PROMPT = 'ok라고만 답하세요.';
  private static readonly SKILLS: Readonly<Record<string, string>> = {
    draft_post: 'cairn-write',
    tidy_session: 'cairn-tidy',
  };
  /** 이 종류의 일을 맡으려면 에이전트에게 있어야 하는 권한. 없는 종류는 누구나 맡는다 */
  static readonly SCOPES: Readonly<Record<string, readonly string[]>> = {
    // 세션은 기본이 비공개라 정리하려면 비공개까지 읽어야 한다
    tidy_session: [Actor.TIDY, Actor.READ_ALL],
  };

  private readonly logged: Omit<TaskEventRow, 'id'>[] = [];

  /** 담당·입력·시도 횟수는 표에 기본값이 있어도 규칙이 저장 전에 읽어서 적어 둔다 */
  static open(
    spaceId: string,
    requestId: string,
    fields: Omit<TaskNew, 'id' | 'space_id'>,
    now: Date,
  ): Task {
    const task = new Task(
      {
        agent_id: null,
        payload: {},
        attempts: 0,
        ...fields,
        id: BaseEntity.newId(),
        space_id: spaceId,
        request_id: requestId,
        status: Task.QUEUED,
        created_at: now,
      },
      true,
    );
    task.announce();
    return task;
  }

  /** AI 로그인의 연결 확인. 어느 판의 로그인을 보는지 함께 적어 둔다 */
  static aiTest(spaceId: string, tool: string, loginVersion: number, now: Date): Task {
    const fields = {
      kind: Task.AI_TEST,
      title: 'AI 연결 확인',
      instruction: Task.AI_TEST_PROMPT,
      payload: { tool, loginVersion },
      priority: Task.AI_TEST_PRIORITY,
    };
    return Task.open(spaceId, BaseEntity.newId(), fields, now);
  }

  static restore(row: TaskRow): Task {
    return new Task(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get agentId(): string | null {
    return this.row.agent_id;
  }

  get isAiTest(): boolean {
    return this.row.kind === Task.AI_TEST;
  }

  /** 결과를 내고 끝났는가. 취소는 결과가 없어서 뺀다 */
  get ended(): boolean {
    return this.row.status === Task.DONE || this.row.status === Task.FAILED;
  }

  /** 실패한 이유 */
  get failure(): string | null {
    const error = (this.row.result as Readonly<Record<string, unknown>> | null)?.error;
    return typeof error === 'string' ? error : null;
  }

  /** 연결 확인이 보는 도구 */
  get testedTool(): string {
    return String(this.payload.tool);
  }

  /** 연결 확인이 이 판의 로그인을 보는가. 그사이 토큰을 바꿨으면 아니다 */
  tests(loginVersion: number): boolean {
    return this.payload.loginVersion === loginVersion;
  }

  /** 이 권한을 가진 에이전트가 맡을 수 있는 일인가 */
  doableWith(scopes: readonly string[]): boolean {
    const needed = Task.SCOPES[this.row.kind];
    return needed === undefined || needed.every((scope) => scopes.includes(scope));
  }

  /** 이번에 쌓인 실행 기록 (Repository가 저장한다) */
  get addedLog(): readonly Omit<TaskEventRow, 'id'>[] {
    return this.logged;
  }

  /** 러너가 빌려 간다: queued → running. 담당이 없던 일은 agentId가 맡는다. 연결 확인은 담당 없이 돈다 */
  lease(runnerId: string, agentId: string | null, now: Date): void {
    this.move([Task.QUEUED], Task.RUNNING);
    if (this.row.agent_id === null && agentId !== null) this.put('agent_id', agentId);
    this.holdLease(runnerId, new Date(now.getTime() + Task.LEASE_MS));
    this.put('attempts', this.row.attempts + 1);
  }

  /**
   * 진행 보고를 받는다. 임대를 늘리되, 취소됐으면 기록만 받아 러너가 응답으로 알게 하고,
   * 결재를 기다리는 중이면 임대를 늘리지 않는다 (에이전트가 남긴 마지막 기록을 받으려고 기록만).
   */
  acceptReport(runnerId: string, now: Date): void {
    this.assertLeasedBy(runnerId);
    if (this.cancelled || this.row.status === Task.WAITING) return;
    this.assertHeldBy(runnerId, now);
    this.put('lease_until', new Date(now.getTime() + Task.LEASE_MS));
  }

  /** 임대를 쥔 러너가 살아 있는 임대로 부르는가. 늦은 제출은 여기서 막힌다 */
  assertHeldBy(runnerId: string, now: Date): void {
    if (this.row.status !== Task.RUNNING)
      throw new RuleViolation(`진행 중인 작업이 아니에요 (${this.row.status})`);
    this.assertLeasedBy(runnerId);
    if (!this.leaseAlive(now)) throw new RuleViolation('임대가 끝난 작업이에요');
  }

  /** 결재를 기다린다: running → waiting. 임대는 남은 시간까지 두고 늘리지 않으며, 끝나도 되돌리지 않는다 */
  waitFor(now: Date): void {
    if (this.row.status === Task.RUNNING && !this.leaseAlive(now))
      throw new RuleViolation('임대가 끝난 작업이에요');
    this.move([Task.RUNNING], Task.WAITING);
  }

  /** 결재 승인: waiting → running. 임대 없이 실행 결과 이벤트를 기다린다 */
  resume(): void {
    this.move([Task.WAITING], Task.RUNNING);
    this.holdLease(null, null);
  }

  /**
   * 결재에서 고쳐 달라고 함: waiting → queued. 에이전트가 말을 받아 다시 하므로 시도 횟수는 새로 센다.
   * 다음 실행은 앞 실행을 기억하지 못하므로 결재의 대상을 작업의 대상으로 넘긴다.
   */
  returnForRevision(
    note: string | null,
    targetKind: string,
    targetId: string,
    targetVersion: number,
  ): void {
    this.move([Task.WAITING], Task.QUEUED);
    this.holdLease(null, null);
    this.put('attempts', 0);
    this.put('payload', { ...this.payload, revisionNote: note });
    this.put('target_kind', targetKind);
    this.put('target_id', targetId);
    this.put('base_version', targetVersion);
  }

  /** 러너가 끝을 알린다. 살아 있는 임대로만 */
  submit(
    runnerId: string,
    status: string,
    result: Readonly<Record<string, unknown>>,
    error: string | null,
    now: Date,
  ): void {
    this.assertHeldBy(runnerId, now);
    if (status === Task.DONE) this.finish(result, now);
    else if (status === Task.FAILED) this.fail(error ?? '러너가 실패로 끝냈어요', now);
    else throw new RuleViolation(`결과는 ${Task.DONE} · ${Task.FAILED} 중 하나예요`);
  }

  /**
   * 결재한 동작의 실행 결과를 받는다. 같은 결과가 두 번 와도 같게, 이미 끝난 작업은 그대로 둔다.
   * 결재 뒤 주인이 취소한 작업도 여기서는 건드리지 않는다.
   */
  concludeExecution(succeeded: boolean, error: string | null, now: Date): void {
    if (this.row.status !== Task.RUNNING) return;
    if (succeeded) this.finish({}, now);
    else this.fail(error ?? '실행하지 못했어요', now);
  }

  /** 끝낸다: running → done */
  finish(result: Readonly<Record<string, unknown>>, now: Date): void {
    this.move([Task.RUNNING], Task.DONE);
    this.close(result, now);
    this.log(Task.LOG_RESULT, '', 0, now);
  }

  /** 실패로 끝낸다: running → failed */
  fail(error: string, now: Date): void {
    this.move([Task.RUNNING], Task.FAILED);
    this.close({ error }, now);
    this.log(Task.LOG_ERROR, error, 0, now);
  }

  /** 주인이 멈춘다. 임대를 쥔 러너는 다음 보고의 응답으로 안다 */
  cancel(now: Date): void {
    this.move([Task.QUEUED, Task.RUNNING, Task.WAITING], Task.CANCELLED);
    this.put('lease_until', null);
    this.put('finished_at', now);
  }

  /** 러너가 처리하지 못하고 돌려준다: running → queued. 실패가 아니라 시도로 세지 않는다 */
  release(runnerId: string, reason: string, now: Date): void {
    this.assertHeldBy(runnerId, now);
    this.move([Task.RUNNING], Task.QUEUED);
    this.holdLease(null, null);
    this.put('attempts', Math.max(0, this.row.attempts - 1));
    this.log(Task.LOG_ERROR, `돌려줌: ${reason}`, 0, now);
  }

  /** 임대가 끝남 (러너가 죽음): 다시 대기열로, MAX_ATTEMPTS번째면 실패로 */
  expire(now: Date): void {
    if (this.row.attempts >= Task.MAX_ATTEMPTS) {
      this.fail('임대가 세 번 끝나 멈췄어요', now);
      this.holdLease(null, null);
      return;
    }
    this.move([Task.RUNNING], Task.QUEUED);
    this.holdLease(null, null);
    this.log(Task.LOG_ERROR, '임대가 끝나 다시 대기열로 돌아갔어요', 0, now);
  }

  log(kind: string, body: string, tokens: number, now: Date): void {
    if (!Task.LOG_KINDS.includes(kind))
      throw new RuleViolation(`기록 종류는 ${Task.LOG_KINDS.join(' · ')} 중 하나예요`);
    this.logged.push({ task_id: this.id, at: now, kind, body, tokens });
  }

  /** 이 작업을 하는 에이전트의 요청자. 그 에이전트의 권한만 담아 작업 토큰이 된다 */
  actorFor(agentId: string, scopes: readonly string[]): AgentActor {
    return new AgentActor(this.row.space_id, agentId, this.id, new Set(scopes));
  }

  /** 바꾼 작업 하나. 목록의 한 줄과 같은 모양이고, 화면은 이 version으로 다음 변경을 보낸다 */
  view(): TaskView {
    return new TaskView(this.row);
  }

  /** 빌려 준 일 하나. 맡은 에이전트의 작업 토큰을 여기서 만든다 */
  jobView(agent: Agent | null, box: SecretBox): JobView {
    const runToken =
      agent && this.actorFor(agent.id, agent.scopes).seal(box, Task.RUN_TOKEN_SECONDS);
    return new JobView(this.row, this.skill, this.revisionNote, agent, runToken);
  }

  progressView(agentPaused: boolean): ProgressView {
    return new ProgressView(this.row, this.cancelled, agentPaused);
  }

  stateView(): JobStateView {
    return new JobStateView(this.row);
  }

  testView(): AiTestView {
    return new AiTestView(this.row);
  }

  private get payload(): Readonly<Record<string, unknown>> {
    return this.row.payload as Readonly<Record<string, unknown>>;
  }

  private get cancelled(): boolean {
    return this.row.status === Task.CANCELLED;
  }

  /** 러너가 쓸 스킬. 없으면 지시만으로 일한다 */
  private get skill(): string | null {
    return Task.SKILLS[this.row.kind] ?? null;
  }

  /** 주인이 결재에서 고쳐 달라고 남긴 말 */
  private get revisionNote(): string | null {
    const note = this.payload.revisionNote;
    return typeof note === 'string' ? note : null;
  }

  private leaseAlive(now: Date): boolean {
    const until = this.row.lease_until;
    return until !== null && until.getTime() > now.getTime();
  }

  private assertLeasedBy(runnerId: string): void {
    if (this.row.leased_by !== runnerId) throw new RuleViolation('다른 러너가 맡은 작업이에요');
  }

  private holdLease(runnerId: string | null, until: Date | null): void {
    this.put('leased_by', runnerId);
    this.put('lease_until', until);
  }

  private close(result: Readonly<Record<string, unknown>>, now: Date): void {
    this.put('result', result);
    this.put('finished_at', now);
  }

  /** 메서드마다 어느 상태에서 올 수 있는지 적는다. 상태 쌍만 보면 lease()가 결재 대기를 가로챌 수 있다 */
  private move(from: readonly string[], to: string): void {
    if (!from.includes(this.row.status))
      throw new RuleViolation(`${this.row.status} 상태의 작업은 ${to}(으)로 바꿀 수 없어요`);
    this.put('status', to);
    this.announce();
  }

  private announce(): void {
    this.record(
      new DomainEvent(Task.CHANGED, 1, this.row.space_id, {
        taskId: this.id,
        status: this.row.status,
      }),
    );
  }
}
