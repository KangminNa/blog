import {
  Actor,
  AgentActor,
  BaseEntity,
  Conflict,
  DomainEvent,
  Forbidden,
  RuleViolation,
  type SecretBox,
  TableEntity,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AiSigninRelayView, AiTestView } from '../ai/ai-login.view';
import type { Goal } from '../goal/goal';
import type { TaskEventRow, TaskNew, TaskRow } from '../task.tables';
import {
  DelegatedView,
  JobStateView,
  JobSubtaskResultView,
  JobView,
  ProgressView,
  TaskView,
} from './task.view';

// 작업 하나. 러너가 임대로 빌려 가고, 에이전트가 결재를 올리고, 결재 뒤 실행 결과로 끝난다.
//   queued → running → waiting → running → done, 그리고 failed · cancelled
// waiting은 무엇을 기다리는지(wait_reason)를 함께 적는다: 결재(approval)면 승인 뒤 running, 하위 작업(subtasks)이면
// 하위 작업이 모두 끝난 뒤 queued로 돌아가 같은 에이전트가 결과를 모은다 (위임).
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
  /**
   * 웹 AI 로그인. 러너가 로그인 명령을 대신 돌리고, 로그인 주소와 사람이 붙여 넣은 코드는 payload로 오간다.
   * 에이전트도 작업 토큰도 없다 (연결 확인과 같다)
   */
  static readonly AI_SIGNIN = 'ai_signin';
  /** 에이전트 없이 러너가 바로 도는 일 */
  static readonly AGENTLESS: readonly string[] = [Task.AI_TEST, Task.AI_SIGNIN];
  /** 서버 브라우저로 하는 작업. 브라우저가 있다고 알린 러너(next_jobs의 browser)에게만 빌려 준다 */
  static readonly BROWSE = 'browse';
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
  /** 실행 기록의 종류 */
  static readonly LOG_READ = 'read';
  static readonly LOG_WRITE = 'write';
  static readonly LOG_RESULT = 'result';
  static readonly LOG_ERROR = 'error';
  static readonly LOG_KINDS: readonly string[] = [
    Task.LOG_READ,
    Task.LOG_WRITE,
    Task.LOG_RESULT,
    Task.LOG_ERROR,
  ];
  /** 연결 확인은 쌓인 일보다 먼저 돈다 */
  private static readonly AI_TEST_PRIORITY = 1000;
  private static readonly AI_TEST_PROMPT = 'ok라고만 답하세요.';
  /** 깨어난 위 작업에게 보내는 하위 작업 결과의 길이 */
  private static readonly SUMMARY_MAX = 2000;
  private static readonly SKILLS: Readonly<Record<string, string>> = {
    draft_post: 'cairn-write',
    tidy_session: 'cairn-tidy',
    browse: 'cairn-browse',
  };
  /** 이 종류의 일을 맡으려면 에이전트에게 있어야 하는 권한. 없는 종류는 누구나 맡는다 */
  static readonly SCOPES: Readonly<Record<string, readonly string[]>> = {
    // 세션은 기본이 비공개라 정리하려면 비공개까지 읽어야 한다
    tidy_session: [Actor.TIDY, Actor.READ_ALL],
    browse: [Actor.BROWSE],
  };

  private readonly logged: Omit<TaskEventRow, 'id'>[] = [];

  /** 새 작업. 담당·입력·시도·임대·위임 칸은 표에 기본값이 있어도 규칙이 저장 전에 읽어서 적어 둔다 */
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
        lease_until: null,
        leased_by: null,
        depth: 0,
        wait_reason: null,
        rounds: 0,
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

  /**
   * 웹 AI 로그인 (tool: claude · codex). 러너가 로그인 명령을 PTY 안에서 돌리고 주소를 알린다.
   * Claude는 사람이 브라우저의 코드를 붙여 넣어야 하고, Codex는 주소와 코드만 보여 주면 된다
   */
  static aiSignin(spaceId: string, tool: string, now: Date): Task {
    const fields = {
      kind: Task.AI_SIGNIN,
      title: `${tool} 로그인`,
      payload: { tool, step: Task.SIGNIN_STARTING },
      priority: Task.AI_TEST_PRIORITY,
    };
    return Task.open(spaceId, BaseEntity.newId(), fields, now);
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

  /** 작업 상세에 보일 payload. 웹 로그인의 코드는 암호문이어도 내보내지 않는다 */
  static shownPayload(kind: string, payload: unknown): unknown {
    if (kind !== Task.AI_SIGNIN || typeof payload !== 'object' || payload === null) return payload;
    const { code: _sealed, ...rest } = payload as Record<string, unknown>;
    return rest;
  }

  /** 이 권한을 가진 에이전트에게 위임할 수 있는 일의 종류 */
  static delegableWith(scopes: readonly string[]): readonly string[] {
    return Task.DELEGABLE.filter((kind) =>
      (Task.SCOPES[kind] ?? []).every((scope) => scopes.includes(scope)),
    );
  }

  /** delegate_task의 답: 맡긴 하위 작업들. 위 작업은 하위 작업을 기다린다 */
  static delegatedView(subtasks: readonly Task[]): DelegatedView {
    return new DelegatedView(
      subtasks.map((t) => t.row),
      Task.WAIT_SUBTASKS,
    );
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get agentId(): string | null {
    return this.row.agent_id;
  }

  /** 이 작업이 향하는 목표. 만들 때 정하고 바꾸지 않는다 */
  get goalId(): string | null {
    return this.row.goal_id;
  }

  get requestId(): string | null {
    return this.row.request_id;
  }

  get waitingForSubtasks(): boolean {
    return this.row.status === Task.WAITING && this.row.wait_reason === Task.WAIT_SUBTASKS;
  }

  get cancelled(): boolean {
    return this.row.status === Task.CANCELLED;
  }

  get isAiTest(): boolean {
    return this.row.kind === Task.AI_TEST;
  }

  /** 에이전트 없이 러너가 바로 도는 일인가 (연결 확인, 웹 로그인) */
  get agentless(): boolean {
    return Task.AGENTLESS.includes(this.row.kind);
  }

  /** 웹 로그인의 도구 (claude · codex). 웹 로그인이 아니면 null */
  get signinTool(): string | null {
    return this.isAiSignin ? String(this.payload.tool) : null;
  }

  /**
   * 사람이 붙여 넣은 코드 (암호화한 값). 로그인이 끝날 때까지 물을 때마다 같은 것을 준다:
   * 응답을 잃어도 러너가 다시 받을 수 있게. 러너는 한 번만 쳐 넣는다. 끝나면 지운다 (forgetSignin)
   */
  get signinCode(): string | null {
    const code = this.payload.code;
    return typeof code === 'string' ? code : null;
  }

  /** 결과를 내고 끝났는가. 취소는 결과가 없어서 뺀다 */
  get ended(): boolean {
    return this.row.status === Task.DONE || this.row.status === Task.FAILED;
  }

  /** 실패한 이유 */
  get failure(): string | null {
    const error = this.result?.error;
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

  /**
   * 러너가 로그인 주소를 찾았다. Claude는 이제 사람이 브라우저의 코드를 붙여 넣을 차례고,
   * Codex는 사람이 주소에서 코드를 입력하면 CLI가 스스로 끝난다
   */
  showSignin(url: string, userCode: string | null): void {
    this.assertSigninRunning();
    const payload = this.payload;
    // 주소는 한 번만 정한다. 러너가 같은 것을 다시 보내면(응답을 못 받은 재시도) 그대로 둔다
    if (payload.step !== Task.SIGNIN_STARTING) {
      if (payload.url === url && (payload.userCode ?? null) === userCode) return;
      throw new Conflict('이미 로그인 주소를 알렸어요');
    }
    const claude = this.signinTool === 'claude';
    this.put('payload', {
      ...payload,
      url,
      userCode,
      step: claude ? Task.SIGNIN_WAITING_CODE : Task.SIGNIN_OPEN_URL,
    });
  }

  /** 사람이 붙여 넣은 코드를 받는다 (암호화한 값). 러너가 가져갈 때까지만 둔다 */
  acceptSigninCode(sealedCode: string): void {
    this.assertSigninRunning();
    if (this.payload.step !== Task.SIGNIN_WAITING_CODE)
      throw new RuleViolation('코드를 붙여 넣을 차례가 아니에요');
    this.put('payload', { ...this.payload, code: sealedCode, step: Task.SIGNIN_VERIFYING });
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
    return this.isAiSignin && this.row.status === Task.DONE && this.row.leased_by === runnerId;
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
    // 웹 로그인을 다시 빌리면(앞 러너가 사라짐) 앞 시도의 주소와 코드는 쓸모가 없다
    if (this.isAiSignin && this.payload.step !== Task.SIGNIN_STARTING)
      this.put('payload', { tool: this.payload.tool, step: Task.SIGNIN_STARTING });
  }

  /**
   * 진행 보고를 받는다. 임대를 늘리되, 취소됐으면 기록만 받아 러너가 응답으로 알게 하고,
   * 결재를 기다리는 중이면 임대를 늘리지 않는다 (에이전트가 남긴 마지막 기록을 받으려고 기록만).
   * 늘린 임대는 version 없이 저장한다 (TaskRepository.saveLease)
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
    const r = this.row;
    if (r.agent_id !== agentId) throw new Forbidden(Actor.AGENT, '이 에이전트의 작업이 아니에요');
    if (r.status !== Task.RUNNING || !this.leaseAlive(now))
      throw new Conflict(`실행 중인 작업이 아니에요 (${r.status})`);
    if (count < 1 || count > Task.DELEGATE_AT_ONCE)
      throw new RuleViolation(`한 번에 1~${Task.DELEGATE_AT_ONCE}개를 맡길 수 있어요 (한도)`);
    if (made + count > Task.SUBTASKS_MAX)
      throw new RuleViolation(
        `작업 하나가 맡길 수 있는 하위 작업은 ${Task.SUBTASKS_MAX}개예요 (한도, 이미 ${made}개)`,
      );
    if (r.depth + 1 > Task.DEPTH_MAX)
      throw new RuleViolation(`위임은 ${Task.DEPTH_MAX}단계까지예요 (한도)`);
    if (r.rounds + 1 > Task.ROUNDS_MAX)
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
    fields: Omit<TaskNew, 'id' | 'space_id'>,
    now: Date,
  ): Task {
    const { kind } = fields;
    if (worker === null || !manager.manages(worker))
      throw new Forbidden(Actor.AGENT, '바로 아래 팀원에게만 맡길 수 있어요');
    if (!Task.DELEGABLE.includes(kind))
      throw new RuleViolation(`맡길 수 있는 일은 ${Task.DELEGABLE.join(' · ')}예요: ${kind}`);
    if (!Task.delegableWith(worker.scopes).includes(kind))
      throw new RuleViolation(`${worker.name}의 권한으로는 할 수 없는 일이에요: ${kind}`);
    const r = this.row;
    return Task.open(
      r.space_id,
      this.subtaskRequestId(requestId),
      {
        ...fields,
        agent_id: worker.id,
        payload: { delegatedBy: this.id },
        priority: r.priority,
        goal_id: r.goal_id,
        parent_id: this.id,
        depth: r.depth + 1,
      },
      now,
    );
  }

  /**
   * 하위 작업을 맡겼다: running → waiting(subtasks). 임대는 결재 대기처럼 남은 시간까지 둔다:
   * 러너는 진행 보고의 답으로 AI를 끄고 제출하지 않는다.
   */
  waitForSubtasks(count: number, now: Date): void {
    this.move([Task.RUNNING], Task.WAITING, Task.WAIT_SUBTASKS);
    this.put('rounds', this.row.rounds + 1);
    this.log(Task.LOG_WRITE, `하위 작업 ${count}개를 맡겼어요`, 0, now);
  }

  /**
   * 하위 작업이 모두 끝났다: waiting(subtasks) → queued. 같은 에이전트가 결과를 받아 모은다.
   * 다시 빌려 가는 일이라 시도 횟수는 새로 센다.
   */
  wakeAfterSubtasks(now: Date): void {
    this.assertWaitingFor(Task.WAIT_SUBTASKS);
    this.move([Task.WAITING], Task.QUEUED);
    this.holdLease(null, null);
    this.put('attempts', 0);
    this.log(Task.LOG_READ, '하위 작업이 모두 끝나 다시 대기열로 돌아갔어요', 0, now);
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
    this.forgetSignin();
  }

  /** 러너가 처리하지 못하고 돌려준다: running → queued. 실패가 아니라 시도로 세지 않는다 */
  release(runnerId: string, reason: string, now: Date): void {
    this.assertHeldBy(runnerId, now);
    this.move([Task.RUNNING], Task.QUEUED);
    this.holdLease(null, null);
    this.put('attempts', Math.max(0, this.row.attempts - 1));
    this.log(Task.LOG_ERROR, `돌려줌: ${reason}`, 0, now);
    this.forgetSignin();
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
    this.forgetSignin();
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

  /**
   * 빌려 준 일 하나. 맡은 에이전트의 작업 토큰을 여기서 만든다.
   * 목표 사슬(goals), 바로 아래 팀(org에서), 깨어난 일이면 하위 작업(children)의 결과를 함께 싣는다
   */
  jobView(
    agent: Agent | null,
    box: SecretBox,
    goals: readonly Goal[],
    org: readonly Agent[],
    children: readonly Task[],
  ): JobView {
    const runToken =
      agent && this.actorFor(agent.id, agent.scopes).seal(box, Task.RUN_TOKEN_SECONDS);
    const team = agent ? org.filter((a) => agent.manages(a)) : [];
    return new JobView(
      this.row,
      this.skill,
      this.revisionNote,
      agent,
      runToken,
      goals.map((g) => g.title),
      team.map((a) => a.memberView(Task.delegableWith(a.scopes))),
      children.map((c) => c.resultView(org.find((a) => a.id === c.row.agent_id)?.name ?? null)),
      Math.max(0, Task.ROUNDS_MAX - this.row.rounds),
    );
  }

  /** 진행 보고의 답. agentPaused는 이 작업의 에이전트가 멈췄는가 */
  progressView(agentPaused: boolean): ProgressView {
    return new ProgressView(this.row, this.cancelled, agentPaused);
  }

  /** submit_result · release_job의 답 */
  stateView(): JobStateView {
    return new JobStateView(this.row);
  }

  /** 맡긴 연결 확인이나 시작한 웹 로그인 */
  testView(): AiTestView {
    return new AiTestView(this.row);
  }

  /** 웹 로그인을 진행하는 러너에게 주는 답. code는 푼 코드 */
  relayView(code: string | null): AiSigninRelayView {
    return new AiSigninRelayView(this.row, this.cancelled, code);
  }

  /** 하위 작업 하나의 결과. 러너는 결과를 { text }로 낸다 */
  private resultView(agentName: string | null): JobSubtaskResultView {
    const text = this.result?.text;
    const summary = typeof text === 'string' ? text.slice(0, Task.SUMMARY_MAX) : null;
    return new JobSubtaskResultView(this.row, agentName, summary, this.failure);
  }

  private get payload(): Readonly<Record<string, unknown>> {
    return (this.row.payload ?? {}) as Readonly<Record<string, unknown>>;
  }

  private get result(): Readonly<Record<string, unknown>> | null {
    return (this.row.result ?? null) as Readonly<Record<string, unknown>> | null;
  }

  private get isAiSignin(): boolean {
    return this.row.kind === Task.AI_SIGNIN;
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

  private assertSigninRunning(): void {
    if (!this.isAiSignin) throw new RuleViolation('웹 로그인 작업이 아니에요');
    if (this.row.status !== Task.RUNNING)
      throw new Conflict(`진행 중인 로그인이 아니에요 (${this.row.status})`);
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
    this.forgetSignin();
  }

  /** 끝나거나 대기열로 돌아간 웹 로그인에는 주소도 코드도 남기지 않는다. 어느 도구였는지만 */
  private forgetSignin(): void {
    if (this.isAiSignin && Object.keys(this.payload).some((key) => key !== 'tool'))
      this.put('payload', { tool: this.payload.tool });
  }

  private assertWaitingFor(reason: string): void {
    const r = this.row;
    if (r.status === Task.WAITING && r.wait_reason !== reason)
      throw new RuleViolation(`${reason}을(를) 기다리는 작업이 아니에요 (${r.wait_reason})`);
  }

  /**
   * 메서드마다 어느 상태에서 올 수 있는지 적는다. 상태 쌍만 보면 lease()가 결재 대기를 가로챌 수 있다.
   * waiting으로 갈 때만 무엇을 기다리는지 적고, 나머지 상태로 가면 지운다 (DB의 CHECK와 같다)
   */
  private move(from: readonly string[], to: string, waitReason: string | null = null): void {
    if (!from.includes(this.row.status))
      throw new RuleViolation(`${this.row.status} 상태의 작업은 ${to}(으)로 바꿀 수 없어요`);
    this.put('status', to);
    const reason = to === Task.WAITING ? waitReason : null;
    if (reason !== this.row.wait_reason) this.put('wait_reason', reason);
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
