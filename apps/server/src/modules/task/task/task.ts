import {
  Actor,
  AgentActor,
  BaseEntity,
  Conflict,
  DomainEvent,
  Forbidden,
  RuleViolation,
  TrackedEntity,
} from '../../platform';
import type { Agent } from '../agent/agent';

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
// waiting은 무엇을 기다리는지(waitReason)를 함께 적는다: 결재(approval)면 승인 뒤 running, 하위 작업(subtasks)이면
// 하위 작업이 모두 끝난 뒤 queued로 돌아가 같은 에이전트가 결과를 모은다 (위임).
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
  /** AI 로그인 연결 확인. 에이전트도 작업 토큰도 없이 러너가 돌린다 */
  static readonly AI_TEST = 'ai_test';
  /**
   * 웹 AI 로그인. 러너가 로그인 명령을 대신 돌리고, 로그인 주소와 사람이 붙여 넣은 코드는 payload로 오간다.
   * 에이전트도 작업 토큰도 없다 (연결 확인과 같다)
   */
  static readonly AI_SIGNIN = 'ai_signin';
  /** 에이전트 없이 러너가 바로 도는 일 */
  static readonly AGENTLESS: readonly string[] = [Task.AI_TEST, Task.AI_SIGNIN];
  /** 웹 로그인의 단계 (payload.step) */
  static readonly SIGNIN_STARTING = 'starting';
  static readonly SIGNIN_OPEN_URL = 'open_url';
  static readonly SIGNIN_WAITING_CODE = 'waiting_code';
  static readonly SIGNIN_VERIFYING = 'verifying';
  static readonly GENERAL = 'general';
  static readonly WAIT_APPROVAL = 'approval';
  static readonly WAIT_SUBTASKS = 'subtasks';
  /** 위임할 수 있는 일의 종류. 받는 에이전트의 권한으로 할 수 있어야 한다 (SCOPES) */
  static readonly DELEGABLE: readonly string[] = [Task.GENERAL, 'draft_post', 'tidy_session'];
  /** 위임 한도: 깊이(주인이 맡긴 작업이 0), 작업 하나가 위임하는 횟수, 한 번에, 작업 하나에 */
  static readonly DEPTH_MAX = 3;
  static readonly ROUNDS_MAX = 3;
  static readonly DELEGATE_AT_ONCE = 5;
  static readonly SUBTASKS_MAX = 10;
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
    private targetKindValue: string | null,
    private targetIdValue: string | null,
    private baseVersionValue: number | null,
    private statusValue: string,
    readonly priority: number,
    private leaseEnd: Date | null,
    private leaseHolder: string | null,
    private tries: number,
    readonly requestId: string | null,
    /** 이 작업이 향하는 목표. 만들 때 정하고 바꾸지 않는다 */
    readonly goalId: string | null,
    /** 이 작업을 맡긴 위 작업 (위임). 주인이 맡긴 작업은 null */
    readonly parentId: string | null,
    /** 위임 깊이. 주인이 맡긴 작업이 0 */
    readonly depth: number,
    private waitReasonValue: string | null,
    private roundsValue: number,
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
    goalId: string | null,
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
      goalId,
      null,
      0,
      null,
      0,
      now,
      null,
      true,
    );
    task.announce();
    return task;
  }

  /**
   * 웹 AI 로그인 (tool: claude · codex). 러너가 로그인 명령을 PTY 안에서 돌리고 주소를 알린다.
   * Claude는 사람이 브라우저의 코드를 붙여 넣어야 하고, Codex는 주소와 코드만 보여 주면 된다
   */
  static aiSignin(spaceId: string, tool: string, now: Date): Task {
    return Task.open(
      spaceId,
      null,
      Task.AI_SIGNIN,
      `${tool} 로그인`,
      '',
      { tool, step: Task.SIGNIN_STARTING },
      null,
      null,
      null,
      Task.AI_TEST_PRIORITY,
      BaseEntity.newId(),
      null,
      now,
    );
  }

  /** AI 로그인의 연결 확인. 어느 판의 로그인을 보는지 함께 적어 둔다 */
  static aiTest(spaceId: string, tool: string, loginVersion: number, now: Date): Task {
    return Task.open(
      spaceId,
      null,
      Task.AI_TEST,
      'AI 연결 확인',
      Task.AI_TEST_PROMPT,
      { tool, loginVersion },
      null,
      null,
      null,
      Task.AI_TEST_PRIORITY,
      BaseEntity.newId(),
      null,
      now,
    );
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
    goalId: string | null,
    parentId: string | null,
    depth: number,
    waitReason: string | null,
    rounds: number,
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
      goalId,
      parentId,
      depth,
      waitReason,
      rounds,
      createdAt,
      finishedAt,
      false,
    );
  }

  get agentId(): string | null {
    return this.agent;
  }

  get targetKind(): string | null {
    return this.targetKindValue;
  }

  get targetId(): string | null {
    return this.targetIdValue;
  }

  get baseVersion(): number | null {
    return this.baseVersionValue;
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

  /** waiting이면 무엇을 기다리는지 (approval · subtasks). 아니면 null */
  get waitReason(): string | null {
    return this.waitReasonValue;
  }

  /** 이 작업이 위임한 횟수 */
  get rounds(): number {
    return this.roundsValue;
  }

  get waitingForSubtasks(): boolean {
    return this.statusValue === Task.WAITING && this.waitReasonValue === Task.WAIT_SUBTASKS;
  }

  /** 끝났는가 (결과든 취소든). 하위 작업이 모두 이렇게 되면 위 작업이 깨어난다 */
  get settled(): boolean {
    return this.ended || this.cancelled;
  }

  get cancelled(): boolean {
    return this.statusValue === Task.CANCELLED;
  }

  get isAiTest(): boolean {
    return this.kind === Task.AI_TEST;
  }

  get isAiSignin(): boolean {
    return this.kind === Task.AI_SIGNIN;
  }

  /** 에이전트 없이 러너가 바로 도는 일인가 (연결 확인, 웹 로그인) */
  get agentless(): boolean {
    return Task.AGENTLESS.includes(this.kind);
  }

  /** 웹 로그인의 도구 (claude · codex). 웹 로그인이 아니면 null */
  get signinTool(): string | null {
    return this.isAiSignin ? String(this.payloadValue.tool) : null;
  }

  /**
   * 러너가 로그인 주소를 찾았다. Claude는 이제 사람이 브라우저의 코드를 붙여 넣을 차례고,
   * Codex는 사람이 주소에서 코드를 입력하면 CLI가 스스로 끝난다
   */
  showSignin(url: string, userCode: string | null): void {
    this.assertSigninRunning();
    // 주소는 한 번만 정한다. 러너가 같은 것을 다시 보내면(응답을 못 받은 재시도) 그대로 둔다
    if (this.payloadValue.step !== Task.SIGNIN_STARTING) {
      if (this.payloadValue.url === url && (this.payloadValue.userCode ?? null) === userCode)
        return;
      throw new Conflict('이미 로그인 주소를 알렸어요');
    }
    const claude = this.signinTool === 'claude';
    this.setPayload({
      ...this.payloadValue,
      url,
      userCode,
      step: claude ? Task.SIGNIN_WAITING_CODE : Task.SIGNIN_OPEN_URL,
    });
  }

  /** 사람이 붙여 넣은 코드를 받는다 (암호화한 값). 러너가 가져갈 때까지만 둔다 */
  acceptSigninCode(sealedCode: string): void {
    this.assertSigninRunning();
    if (this.payloadValue.step !== Task.SIGNIN_WAITING_CODE)
      throw new RuleViolation('코드를 붙여 넣을 차례가 아니에요');
    this.setPayload({ ...this.payloadValue, code: sealedCode, step: Task.SIGNIN_VERIFYING });
  }

  /**
   * 사람이 붙여 넣은 코드 (암호화한 값). 로그인이 끝날 때까지 물을 때마다 같은 것을 준다:
   * 응답을 잃어도 러너가 다시 받을 수 있게. 러너는 한 번만 쳐 넣는다. 끝나면 지운다 (forgetSignin)
   */
  get signinCode(): string | null {
    const code = this.payloadValue.code;
    return typeof code === 'string' ? code : null;
  }

  /**
   * 이 러너가 맡았던 일인가 (지금 상태와 상관없이). 실행 중에 CLI가 갱신한 자격은 주인이 취소한 뒤에도
   * 되돌려 써야 한다: 버리면 다음 실행이 이미 쓴 갱신 토큰을 내밀어 로그인이 깨진다
   */
  assertWorkedBy(runnerId: string): void {
    this.assertLeasedBy(runnerId);
  }

  /** 이 러너가 자격을 넘겨 이미 끝난 웹 로그인인가. 응답을 잃은 러너가 다시 보내도 같은 답을 준다 */
  signinDoneBy(runnerId: string): boolean {
    return this.isAiSignin && this.statusValue === Task.DONE && this.leaseHolder === runnerId;
  }

  /** 작업 상세에 보일 payload. 웹 로그인의 코드는 암호문이어도 내보내지 않는다 */
  static shownPayload(kind: string, payload: unknown): unknown {
    if (kind !== Task.AI_SIGNIN || typeof payload !== 'object' || payload === null) return payload;
    const { code: _sealed, ...rest } = payload as Record<string, unknown>;
    return rest;
  }

  /** 결과를 내고 끝났는가. 취소는 결과가 없어서 뺀다 */
  get ended(): boolean {
    return this.statusValue === Task.DONE || this.statusValue === Task.FAILED;
  }

  /** 실패한 이유 */
  get failure(): string | null {
    const error = this.resultValue?.error;
    return typeof error === 'string' ? error : null;
  }

  /** 러너가 쓸 스킬. 없으면 지시만으로 일한다 */
  get skill(): string | null {
    return Task.SKILLS[this.kind] ?? null;
  }

  /** 이 권한을 가진 에이전트에게 위임할 수 있는 일의 종류 */
  static delegableWith(scopes: readonly string[]): readonly string[] {
    return Task.DELEGABLE.filter((kind) =>
      (Task.SCOPES[kind] ?? []).every((scope) => scopes.includes(scope)),
    );
  }

  /** 이 권한을 가진 에이전트가 맡을 수 있는 일인가 */
  doableWith(scopes: readonly string[]): boolean {
    const needed = Task.SCOPES[this.kind];
    return needed === undefined || needed.every((scope) => scopes.includes(scope));
  }

  /** 주인이 결재에서 고쳐 달라고 남긴 말 */
  get revisionNote(): string | null {
    const note = this.payloadValue.revisionNote;
    return typeof note === 'string' ? note : null;
  }

  private assertSigninRunning(): void {
    if (!this.isAiSignin) throw new RuleViolation('웹 로그인 작업이 아니에요');
    if (this.statusValue !== Task.RUNNING)
      throw new Conflict(`진행 중인 로그인이 아니에요 (${this.statusValue})`);
  }

  private setPayload(payload: Readonly<Record<string, unknown>>): void {
    this.payloadValue = payload;
    this.track('payload', payload);
  }

  /** 이번에 쌓인 실행 기록 (Repository가 저장한다) */
  get addedLog(): readonly TaskLogEntry[] {
    return this.logged;
  }

  /** 러너가 빌려 간다: queued → running. 담당이 없던 일은 agentId가 맡는다. 연결 확인은 담당 없이 돈다 */
  lease(runnerId: string, agentId: string | null, now: Date): void {
    this.move([Task.QUEUED], Task.RUNNING);
    if (this.agent === null && agentId !== null) {
      this.agent = agentId;
      this.track('agent_id', agentId);
    }
    this.holdLease(runnerId, new Date(now.getTime() + Task.LEASE_MS));
    this.tries += 1;
    this.track('attempts', this.tries);
    // 웹 로그인을 다시 빌리면(앞 러너가 사라짐) 앞 시도의 주소와 코드는 쓸모가 없다
    if (this.isAiSignin && this.payloadValue.step !== Task.SIGNIN_STARTING)
      this.setPayload({ tool: this.payloadValue.tool, step: Task.SIGNIN_STARTING });
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
    this.move([Task.RUNNING], Task.WAITING, Task.WAIT_APPROVAL);
  }

  /** 결재 승인: waiting → running. 임대 없이 실행 결과 이벤트를 기다린다 */
  resume(): void {
    this.assertWaitingFor(Task.WAIT_APPROVAL);
    this.move([Task.WAITING], Task.RUNNING);
    this.holdLease(null, null);
  }

  /** 위임에 쓰는 하위 작업의 request_id. AI가 만든 값을 작업마다 따로 센다 */
  subtaskRequestId(requestId: string): string {
    return `delegate:${this.id}:${requestId}`;
  }

  /**
   * 이번에 count개를 맡길 수 있는가. 이 작업의 에이전트가 살아 있는 임대로 일하는 중이어야 하고,
   * 한 번에 DELEGATE_AT_ONCE개, 작업 하나에 SUBTASKS_MAX개(made는 이미 맡긴 수), 깊이 DEPTH_MAX, 라운드 ROUNDS_MAX까지
   */
  assertCanDelegate(agentId: string, count: number, made: number, now: Date): void {
    if (this.agent !== agentId) throw new Forbidden(Actor.AGENT, '이 에이전트의 작업이 아니에요');
    if (this.statusValue !== Task.RUNNING || !this.leaseAlive(now))
      throw new Conflict(`실행 중인 작업이 아니에요 (${this.statusValue})`);
    if (count < 1 || count > Task.DELEGATE_AT_ONCE)
      throw new RuleViolation(`한 번에 1~${Task.DELEGATE_AT_ONCE}개를 맡길 수 있어요 (한도)`);
    if (made + count > Task.SUBTASKS_MAX)
      throw new RuleViolation(
        `작업 하나가 맡길 수 있는 하위 작업은 ${Task.SUBTASKS_MAX}개예요 (한도, 이미 ${made}개)`,
      );
    if (this.depth + 1 > Task.DEPTH_MAX)
      throw new RuleViolation(`위임은 ${Task.DEPTH_MAX}단계까지예요 (한도)`);
    if (this.roundsValue + 1 > Task.ROUNDS_MAX)
      throw new RuleViolation(
        `작업 하나가 위임할 수 있는 횟수는 ${Task.ROUNDS_MAX}번이에요 (한도)`,
      );
  }

  /**
   * 하위 작업 하나를 만든다. 받는 쪽은 manager의 바로 아래 팀원이어야 하고, 그 에이전트의 권한으로 할 수 있는 종류여야 한다.
   * 하위 작업은 이 작업의 목표와 우선순위를 물려받고, 담당은 worker로 정해진다.
   */
  subtask(
    manager: Agent,
    worker: Agent | null,
    requestId: string,
    kind: string,
    title: string,
    instruction: string,
    targetKind: string | null,
    targetId: string | null,
    baseVersion: number | null,
    now: Date,
  ): Task {
    if (worker === null || !manager.manages(worker))
      throw new Forbidden(Actor.AGENT, '바로 아래 팀원에게만 맡길 수 있어요');
    if (!Task.DELEGABLE.includes(kind))
      throw new RuleViolation(`맡길 수 있는 일은 ${Task.DELEGABLE.join(' · ')}예요: ${kind}`);
    if (!Task.delegableWith(worker.scopes).includes(kind))
      throw new RuleViolation(`${worker.name}의 권한으로는 할 수 없는 일이에요: ${kind}`);
    return new Task(
      BaseEntity.newId(),
      1,
      this.spaceId,
      worker.id,
      kind,
      title,
      instruction,
      { delegatedBy: this.id },
      null,
      targetKind,
      targetId,
      baseVersion,
      Task.QUEUED,
      this.priority,
      null,
      null,
      0,
      this.subtaskRequestId(requestId),
      this.goalId,
      this.id,
      this.depth + 1,
      null,
      0,
      now,
      null,
      true,
    ).announced();
  }

  /**
   * 하위 작업을 맡겼다: running → waiting(subtasks). 임대는 결재 대기처럼 남은 시간까지 둔다:
   * 러너는 진행 보고의 답으로 AI를 끄고 제출하지 않는다.
   */
  waitForSubtasks(count: number, now: Date): void {
    this.move([Task.RUNNING], Task.WAITING, Task.WAIT_SUBTASKS);
    this.roundsValue += 1;
    this.track('rounds', this.roundsValue);
    this.log(TaskLogEntry.WRITE, `하위 작업 ${count}개를 맡겼어요`, 0, now);
  }

  /**
   * 하위 작업이 모두 끝났다: waiting(subtasks) → queued. 같은 에이전트가 결과를 받아 모은다.
   * 다시 빌려 가는 일이라 시도 횟수는 새로 센다.
   */
  wakeAfterSubtasks(now: Date): void {
    this.assertWaitingFor(Task.WAIT_SUBTASKS);
    this.move([Task.WAITING], Task.QUEUED);
    this.holdLease(null, null);
    this.tries = 0;
    this.track('attempts', 0);
    this.log(TaskLogEntry.READ, '하위 작업이 모두 끝나 다시 대기열로 돌아갔어요', 0, now);
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
    this.assertWaitingFor(Task.WAIT_APPROVAL);
    this.move([Task.WAITING], Task.QUEUED);
    this.holdLease(null, null);
    this.tries = 0;
    this.track('attempts', 0);
    this.payloadValue = { ...this.payloadValue, revisionNote: note };
    this.track('payload', this.payloadValue);
    this.targetKindValue = targetKind;
    this.track('target_kind', targetKind);
    this.targetIdValue = targetId;
    this.track('target_id', targetId);
    this.baseVersionValue = targetVersion;
    this.track('base_version', targetVersion);
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
    // 웹 로그인은 자격(ai_signin credential)이 와야 끝난다. 러너가 실패만 알린다
    if (this.isAiSignin && status === Task.DONE)
      throw new RuleViolation('웹 로그인은 ai_signin으로 자격을 보내야 끝나요');
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
    this.forgetSignin();
  }

  /** 러너가 처리하지 못하고 돌려준다: running → queued. 실패가 아니라 시도로 세지 않는다 */
  release(runnerId: string, reason: string, now: Date): void {
    this.assertHeldBy(runnerId, now);
    this.move([Task.RUNNING], Task.QUEUED);
    this.holdLease(null, null);
    this.tries = Math.max(0, this.tries - 1);
    this.track('attempts', this.tries);
    this.log(TaskLogEntry.ERROR, `돌려줌: ${reason}`, 0, now);
    this.forgetSignin();
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
    this.forgetSignin();
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
    this.forgetSignin();
  }

  /** 끝나거나 대기열로 돌아간 웹 로그인에는 주소도 코드도 남기지 않는다. 어느 도구였는지만 */
  private forgetSignin(): void {
    if (this.isAiSignin && Object.keys(this.payloadValue).some((key) => key !== 'tool'))
      this.setPayload({ tool: this.payloadValue.tool });
  }

  private assertWaitingFor(reason: string): void {
    if (this.statusValue === Task.WAITING && this.waitReasonValue !== reason)
      throw new RuleViolation(`${reason}을(를) 기다리는 작업이 아니에요 (${this.waitReasonValue})`);
  }

  /**
   * 메서드마다 어느 상태에서 올 수 있는지 적는다. 상태 쌍만 보면 lease()가 결재 대기를 가로챌 수 있다.
   * waiting으로 갈 때만 무엇을 기다리는지 적고, 나머지 상태로 가면 지운다 (DB의 CHECK와 같다)
   */
  private move(from: readonly string[], to: string, waitReason: string | null = null): void {
    if (!from.includes(this.statusValue))
      throw new RuleViolation(`${this.statusValue} 상태의 작업은 ${to}(으)로 바꿀 수 없어요`);
    this.statusValue = to;
    this.track('status', to);
    const reason = to === Task.WAITING ? waitReason : null;
    if (reason !== this.waitReasonValue) {
      this.waitReasonValue = reason;
      this.track('wait_reason', reason);
    }
    this.announce();
  }

  private announced(): Task {
    this.announce();
    return this;
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
