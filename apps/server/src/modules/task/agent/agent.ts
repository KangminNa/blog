import {
  Actor,
  BaseEntity,
  DomainEvent,
  Forbidden,
  RuleViolation,
  TrackedEntity,
} from '../../platform';

// 일을 맡는 에이전트. 할 수 있는 일(scopes)과 결재를 올려 할 수 있는 동작(approvalActions), 한 달 토큰 한도를 가진다.
// 이름·역할 같은 단순한 칸은 set으로, 멈춤·다시 시작은 메서드로만 바꾼다.
export class Agent extends TrackedEntity {
  static readonly ACTIVE = 'active';
  static readonly PAUSED = 'paused';
  static readonly TOOLS: readonly string[] = ['claude', 'codex'];
  /** 에이전트에게 줄 수 있는 권한. run은 러너의 것이라 없다: 에이전트가 스스로 일을 빌릴 수 없게 */
  static readonly SCOPES: readonly string[] = [
    Actor.UPLOAD,
    Actor.READ_PUBLIC,
    Actor.READ_ALL,
    Actor.TIDY,
    Actor.WRITE,
  ];
  private static readonly NAME_MAX = 60;
  private static readonly ROLE_MAX = 2000;
  private static readonly ACTION = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;
  /** 이 동작은 서버가 한도를 넘었을 때만 올린다 */
  private static readonly SERVER_ACTION = 'task.agent.raise_limit';

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    private nameValue: string,
    private roleValue: string,
    private toolValue: string,
    private scopeList: readonly string[],
    private actionList: readonly string[],
    private limitValue: number | null,
    private statusValue: string,
    readonly createdAt: Date,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

  static open(
    spaceId: string,
    name: string,
    role: string,
    tool: string,
    scopes: readonly string[],
    approvalActions: readonly string[],
    monthlyLimit: number | null,
    now: Date,
  ): Agent {
    const agent = new Agent(
      BaseEntity.newId(),
      1,
      spaceId,
      '',
      '',
      '',
      [],
      [],
      null,
      Agent.ACTIVE,
      now,
      true,
    );
    agent.name = name;
    agent.role = role;
    agent.tool = tool;
    agent.scopes = scopes;
    agent.approvalActions = approvalActions;
    agent.monthlyLimit = monthlyLimit;
    agent.announce();
    return agent;
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    name: string,
    role: string,
    tool: string,
    scopes: readonly string[],
    approvalActions: readonly string[],
    monthlyLimit: number | null,
    status: string,
    createdAt: Date,
  ): Agent {
    return new Agent(
      id,
      version,
      spaceId,
      name,
      role,
      tool,
      scopes,
      approvalActions,
      monthlyLimit,
      status,
      createdAt,
      false,
    );
  }

  get name(): string {
    return this.nameValue;
  }

  set name(value: string) {
    const name = value.trim();
    if (name.length < 1 || name.length > Agent.NAME_MAX)
      throw new RuleViolation(`이름은 1~${Agent.NAME_MAX}자예요`);
    this.nameValue = name;
    this.track('name', name);
  }

  get role(): string {
    return this.roleValue;
  }

  set role(value: string) {
    if (value.length > Agent.ROLE_MAX)
      throw new RuleViolation(`역할은 ${Agent.ROLE_MAX}자까지예요`);
    this.roleValue = value;
    this.track('role', value);
  }

  get tool(): string {
    return this.toolValue;
  }

  set tool(value: string) {
    if (!Agent.TOOLS.includes(value))
      throw new RuleViolation(`AI 도구는 ${Agent.TOOLS.join(' · ')} 중 하나예요`);
    this.toolValue = value;
    this.track('tool', value);
  }

  get scopes(): readonly string[] {
    return this.scopeList;
  }

  set scopes(value: readonly string[]) {
    const unknown = value.filter((s) => !Agent.SCOPES.includes(s));
    if (unknown.length > 0)
      throw new RuleViolation(`에이전트에게 줄 수 없는 권한이에요: ${unknown.join(', ')}`);
    this.scopeList = Agent.SCOPES.filter((s) => value.includes(s));
    this.track('scopes', this.scopeList);
  }

  get approvalActions(): readonly string[] {
    return this.actionList;
  }

  set approvalActions(value: readonly string[]) {
    const wrong = value.filter((a) => !Agent.ACTION.test(a) || a === Agent.SERVER_ACTION);
    if (wrong.length > 0)
      throw new RuleViolation(`결재로 맡길 수 없는 동작이에요: ${wrong.join(', ')}`);
    this.actionList = [...new Set(value)];
    this.track('approval_actions', this.actionList);
  }

  get monthlyLimit(): number | null {
    return this.limitValue;
  }

  set monthlyLimit(value: number | null) {
    if (value !== null && value < 1) throw new RuleViolation('한도는 1 이상이에요');
    this.limitValue = value;
    this.track('monthly_limit', value);
  }

  get status(): string {
    return this.statusValue;
  }

  get paused(): boolean {
    return this.statusValue === Agent.PAUSED;
  }

  /** 멈춘다. 새 일을 빌려주지 않는다. 이미 멈췄으면 그대로 */
  pause(): void {
    this.moveTo(Agent.PAUSED);
  }

  resume(): void {
    this.moveTo(Agent.ACTIVE);
  }

  /** 이번 달 사용량이 한도를 넘었는데 아직 움직이고 있는가 (이미 멈췄으면 결재를 또 올리지 않는다) */
  overLimit(usedThisMonth: number): boolean {
    return !this.paused && this.limitValue !== null && usedThisMonth > this.limitValue;
  }

  /** 한도 올리기 결재가 승인됨: 한도를 두 배로 하고 다시 움직인다 */
  raiseLimit(): void {
    if (this.limitValue !== null) this.monthlyLimit = this.limitValue * 2;
    this.resume();
  }

  /** 이 에이전트가 결재를 올릴 수 있는 동작인가. 주인이 정해 둔 동작만 */
  assertMayRequest(action: string): void {
    if (!this.actionList.includes(action))
      throw new Forbidden(action, `이 에이전트에게 맡기지 않은 동작이에요: ${action}`);
  }

  private moveTo(status: string): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    this.track('status', status);
    this.announce();
  }

  private announce(): void {
    this.record(
      new DomainEvent('task.agent.changed', 1, this.spaceId, {
        agentId: this.id,
        status: this.statusValue,
      }),
    );
  }
}
