import {
  Actor,
  AgentActor,
  BaseEntity,
  DomainEvent,
  RuleViolation,
  TrackedEntity,
} from '../../platform';

/** 실행 기록 한 줄 (추가만). 작업과 함께 저장한다 */
export class TaskLogEntry {
  static readonly READ = 'read';
  static readonly WRITE = 'write';
  static readonly RESULT = 'result';
  static readonly ERROR = 'error';
  static readonly KINDS: readonly string[] = [
    TaskLogEntry.READ,
    TaskLogEntry.WRITE,
    TaskLogEntry.RESULT,
    TaskLogEntry.ERROR,
  ];

  constructor(
    readonly kind: string,
    readonly body: string,
    readonly tokens: number,
    readonly at: Date,
  ) {}
}

// 작업 하나. 러너가 임대로 빌려 가고, 에이전트가 결재를 올리고, 결재 뒤 실행 결과로 끝난다.
//   queued → running → waiting → running → done, 그리고 failed · cancelled
// 상태는 아래 메서드로만 바꾼다. 허용되지 않은 변경은 RuleViolation.
export class Task extends TrackedEntity {
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
  private static readonly SKILLS: Readonly<Record<string, string>> = {
    draft_post: 'cairn-write',
    tidy_session: 'cairn-tidy',
  };
  /** 이 종류의 일을 맡으려면 에이전트에게 있어야 하는 권한. 없는 종류는 누구나 맡는다 */
  static readonly SCOPES: Readonly<Record<string, string>> = {
    tidy_session: Actor.TIDY,
  };

  private readonly logged: TaskLogEntry[] = [];

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    private agent: string | null,
    readonly kind: string,
    readonly title: string,
    readonly instruction: string,
    private payloadValue: Readonly<Record<string, unknown>>,
    private resultValue: Readonly<Record<string, unknown>> | null,
    readonly targetKind: string | null,
    readonly targetId: string | null,
    readonly baseVersion: number | null,
    private statusValue: string,
    readonly priority: number,
    private leaseEnd: Date | null,
    private leaseHolder: string | null,
    private tries: number,
    readonly requestId: string | null,
    readonly createdAt: Date,
    private finishedOn: Date | null,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  static open(
    spaceId: string,
    agentId: string | null,
    kind: string,
    title: string,
    instruction: string,
    payload: Readonly<Record<string, unknown>>,
    targetKind: string | null,
    targetId: string | null,
    baseVersion: number | null,
    priority: number,
    requestId: string,
    now: Date,
  ): Task {
    const task = new Task(
      BaseEntity.newId(),
      1,
      spaceId,
      agentId,
      kind,
      title,
      instruction,
      payload,
      null,
      targetKind,
      targetId,
      baseVersion,
      Task.QUEUED,
      priority,
      null,
      null,
      0,
      requestId,
      now,
      null,
      true,
    );
    task.announce();
    return task;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    agentId: string | null,
    kind: string,
    title: string,
    instruction: string,
    payload: Readonly<Record<string, unknown>>,
    result: Readonly<Record<string, unknown>> | null,
    targetKind: string | null,
    targetId: string | null,
    baseVersion: number | null,
    status: string,
    priority: number,
    leaseUntil: Date | null,
    leasedBy: string | null,
    attempts: number,
    requestId: string | null,
    createdAt: Date,
    finishedAt: Date | null,
  ): Task {
    return new Task(
      id,
      version,
      spaceId,
      agentId,
      kind,
      title,
      instruction,
      payload,
      result,
      targetKind,
      targetId,
      baseVersion,
      status,
      priority,
      leaseUntil,
      leasedBy,
      attempts,
      requestId,
      createdAt,
      finishedAt,
      false,
    );
  }

  get agentId(): string | null {
    return this.agent;
  }

  get payload(): Readonly<Record<string, unknown>> {
    return this.payloadValue;
  }

  get result(): Readonly<Record<string, unknown>> | null {
    return this.resultValue;
  }

  get status(): string {
    return this.statusValue;
  }

  get leaseUntil(): Date | null {
    return this.leaseEnd;
  }

  get leasedBy(): string | null {
    return this.leaseHolder;
  }

  get attempts(): number {
    return this.tries;
  }

  get finishedAt(): Date | null {
    return this.finishedOn;
  }

  get cancelled(): boolean {
    return this.statusValue === Task.CANCELLED;
  }

  /** 러너가 쓸 스킬. 없으면 지시만으로 일한다 */
  get skill(): string | null {
    return Task.SKILLS[this.kind] ?? null;
  }

  /** 이 권한을 가진 에이전트가 맡을 수 있는 일인가 */
  doableWith(scopes: readonly string[]): boolean {
    const needed = Task.SCOPES[this.kind];
    return needed === undefined || scopes.includes(needed);
  }

  /** 주인이 결재에서 고쳐 달라고 남긴 말 */
  get revisionNote(): string | null {
    const note = this.payloadValue.revisionNote;
    return typeof note === 'string' ? note : null;
  }

  /** 이번에 쌓인 실행 기록 (Repository가 저장한다) */
  get addedLog(): readonly TaskLogEntry[] {
    return this.logged;
  }

  /** 러너가 빌려 간다: queued → running. 담당이 없던 일은 agentId가 맡는다 */
  lease(runnerId: string, agentId: string, now: Date): void {
    this.move([Task.QUEUED], Task.RUNNING);
    if (this.agent === null) {
      this.agent = agentId;
      this.track('agent_id', agentId);
    }
    this.holdLease(runnerId, new Date(now.getTime() + Task.LEASE_MS));
    this.tries += 1;
    this.track('attempts', this.tries);
  }

  /**
   * 진행 보고를 받는다. 임대를 늘리되, 취소됐으면 기록만 받아 러너가 응답으로 알게 하고,
   * 결재를 기다리는 중이면 임대를 늘리지 않는다 (에이전트가 남긴 마지막 기록을 받으려고 기록만).
   */
  acceptReport(runnerId: string, now: Date): void {
    this.assertLeasedBy(runnerId);
    if (this.cancelled || this.statusValue === Task.WAITING) return;
    this.assertHeldBy(runnerId, now);
    this.leaseEnd = new Date(now.getTime() + Task.LEASE_MS);
  }

  /** 임대를 쥔 러너가 살아 있는 임대로 부르는가. 늦은 제출은 여기서 막힌다 */
  assertHeldBy(runnerId: string, now: Date): void {
    if (this.statusValue !== Task.RUNNING)
      throw new RuleViolation(`진행 중인 작업이 아니에요 (${this.statusValue})`);
    this.assertLeasedBy(runnerId);
    if (!this.leaseAlive(now)) throw new RuleViolation('임대가 끝난 작업이에요');
  }

  /** 결재를 기다린다: running → waiting. 임대는 남은 시간까지 두고 늘리지 않으며, 끝나도 되돌리지 않는다 */
  waitFor(now: Date): void {
    if (this.statusValue === Task.RUNNING && !this.leaseAlive(now))
      throw new RuleViolation('임대가 끝난 작업이에요');
    this.move([Task.RUNNING], Task.WAITING);
  }

  /** 결재 승인: waiting → running. 임대 없이 실행 결과 이벤트를 기다린다 */
  resume(): void {
    this.move([Task.WAITING], Task.RUNNING);
    this.holdLease(null, null);
  }

  /** 결재에서 고쳐 달라고 함: waiting → queued. 에이전트가 말을 받아 다시 하므로 시도 횟수는 새로 센다 */
  returnForRevision(note: string | null): void {
    this.move([Task.WAITING], Task.QUEUED);
    this.holdLease(null, null);
    this.tries = 0;
    this.track('attempts', 0);
    this.payloadValue = { ...this.payloadValue, revisionNote: note };
    this.track('payload', this.payloadValue);
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
    if (this.statusValue !== Task.RUNNING) return;
    if (succeeded) this.finish({}, now);
    else this.fail(error ?? '실행하지 못했어요', now);
  }

  /** 끝낸다: running → done */
  finish(result: Readonly<Record<string, unknown>>, now: Date): void {
    this.move([Task.RUNNING], Task.DONE);
    this.close(result, now);
    this.log(TaskLogEntry.RESULT, '', 0, now);
  }

  /** 실패로 끝낸다: running → failed */
  fail(error: string, now: Date): void {
    this.move([Task.RUNNING], Task.FAILED);
    this.close({ error }, now);
    this.log(TaskLogEntry.ERROR, error, 0, now);
  }

  /** 주인이 멈춘다. 임대를 쥔 러너는 다음 보고의 응답으로 안다 */
  cancel(now: Date): void {
    this.move([Task.QUEUED, Task.RUNNING, Task.WAITING], Task.CANCELLED);
    this.leaseEnd = null;
    this.track('lease_until', null);
    this.finishedOn = now;
    this.track('finished_at', now);
  }

  /** 러너가 처리하지 못하고 돌려준다: running → queued. 실패가 아니라 시도로 세지 않는다 */
  release(runnerId: string, reason: string, now: Date): void {
    this.assertHeldBy(runnerId, now);
    this.move([Task.RUNNING], Task.QUEUED);
    this.holdLease(null, null);
    this.tries = Math.max(0, this.tries - 1);
    this.track('attempts', this.tries);
    this.log(TaskLogEntry.ERROR, `돌려줌: ${reason}`, 0, now);
  }

  /** 임대가 끝남 (러너가 죽음): 다시 대기열로, MAX_ATTEMPTS번째면 실패로 */
  expire(now: Date): void {
    if (this.tries >= Task.MAX_ATTEMPTS) {
      this.fail('임대가 세 번 끝나 멈췄어요', now);
      this.holdLease(null, null);
      return;
    }
    this.move([Task.RUNNING], Task.QUEUED);
    this.holdLease(null, null);
    this.log(TaskLogEntry.ERROR, '임대가 끝나 다시 대기열로 돌아갔어요', 0, now);
  }

  log(kind: string, body: string, tokens: number, now: Date): void {
    if (!TaskLogEntry.KINDS.includes(kind))
      throw new RuleViolation(`기록 종류는 ${TaskLogEntry.KINDS.join(' · ')} 중 하나예요`);
    this.logged.push(new TaskLogEntry(kind, body, tokens, now));
  }

  /** 이 작업을 하는 에이전트의 요청자. 그 에이전트의 권한만 담아 작업 토큰이 된다 */
  actorFor(agentId: string, scopes: readonly string[]): AgentActor {
    return new AgentActor(this.spaceId, agentId, this.id, new Set(scopes));
  }

  private leaseAlive(now: Date): boolean {
    return this.leaseEnd !== null && this.leaseEnd.getTime() > now.getTime();
  }

  private assertLeasedBy(runnerId: string): void {
    if (this.leaseHolder !== runnerId) throw new RuleViolation('다른 러너가 맡은 작업이에요');
  }

  private holdLease(runnerId: string | null, until: Date | null): void {
    this.leaseHolder = runnerId;
    this.leaseEnd = until;
    this.track('leased_by', runnerId);
    this.track('lease_until', until);
  }

  private close(result: Readonly<Record<string, unknown>>, now: Date): void {
    this.resultValue = result;
    this.track('result', result);
    this.finishedOn = now;
    this.track('finished_at', now);
  }

  /** 메서드마다 어느 상태에서 올 수 있는지 적는다. 상태 쌍만 보면 lease()가 결재 대기를 가로챌 수 있다 */
  private move(from: readonly string[], to: string): void {
    if (!from.includes(this.statusValue))
      throw new RuleViolation(`${this.statusValue} 상태의 작업은 ${to}(으)로 바꿀 수 없어요`);
    this.statusValue = to;
    this.track('status', to);
    this.announce();
  }

  private announce(): void {
    this.record(
      new DomainEvent(Task.CHANGED, 1, this.spaceId, {
        taskId: this.id,
        status: this.statusValue,
      }),
    );
  }
}
