import {
  Actor,
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  Forbidden,
  RuleViolation,
  TableEntity,
} from '../../platform';
import type { AgentNew, AgentRow } from '../task.tables';
import { AgentUsageView } from '../usage/usage.view';
import { AgentView } from './agent.view';

// 일을 맡는 에이전트. 할 수 있는 일(scopes)과 결재를 올려 할 수 있는 동작(approval_actions), 토큰 한도를 가진다.
// 주인이 정하는 칸은 RULES를 지나서만 바뀌고, 멈춤·다시 시작은 메서드로만 바뀐다.
// 한 달 한도는 넘기면 멈추고 결재를 받는다. 5시간 한도와 구독 사용률은 닿으면 새 일만 쉬고 시간이 지나면 저절로 돌아온다 (holds).
export class Agent extends TableEntity<AgentRow, AgentNew> {
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
  private static readonly PLAN_PERCENT_MAX = 100;
  private static readonly ACTION = /^[a-z]+\.[a-z_]+\.[a-z_]+$/;
  /** 이 동작은 서버가 한도를 넘었을 때만 올린다 */
  private static readonly SERVER_ACTION = 'task.agent.raise_limit';

  /** 주인이 정하는 칸과 그 규칙 */
  private static readonly RULES: ColumnRules<AgentRow> = {
    name: (value) => {
      const name = value.trim();
      if (name.length < 1 || name.length > Agent.NAME_MAX)
        throw new RuleViolation(`이름은 1~${Agent.NAME_MAX}자예요`);
      return name;
    },
    role: (value) => {
      if (value.length > Agent.ROLE_MAX)
        throw new RuleViolation(`역할은 ${Agent.ROLE_MAX}자까지예요`);
      return value;
    },
    tool: (value) => {
      if (!Agent.TOOLS.includes(value))
        throw new RuleViolation(`AI 도구는 ${Agent.TOOLS.join(' · ')} 중 하나예요`);
      return value;
    },
    scopes: (value) => {
      const unknown = value.filter((s) => !Agent.SCOPES.includes(s));
      if (unknown.length > 0)
        throw new RuleViolation(`에이전트에게 줄 수 없는 권한이에요: ${unknown.join(', ')}`);
      return Agent.SCOPES.filter((s) => value.includes(s));
    },
    approval_actions: (value) => {
      const wrong = value.filter((a) => !Agent.ACTION.test(a) || a === Agent.SERVER_ACTION);
      if (wrong.length > 0)
        throw new RuleViolation(`결재로 맡길 수 없는 동작이에요: ${wrong.join(', ')}`);
      return [...new Set(value)];
    },
    monthly_limit: (value) => {
      if (value !== null && value < 1) throw new RuleViolation('한도는 1 이상이에요');
      return value;
    },
    five_hour_limit: (value) => {
      if (value !== null && value < 1) throw new RuleViolation('5시간 한도는 1 이상이에요');
      return value;
    },
    plan_stop_percent: (value) => {
      if (value !== null && (value < 1 || value > Agent.PLAN_PERCENT_MAX))
        throw new RuleViolation(`구독 사용률은 1~${Agent.PLAN_PERCENT_MAX}%예요`);
      return value;
    },
  };

  static open(spaceId: string, fields: Partial<AgentRow>, now: Date): Agent {
    const agent = new Agent(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name: '',
        tool: '',
        status: Agent.ACTIVE,
        created_at: now,
      },
      true,
    );
    agent.edit({ name: '', tool: '', ...fields });
    agent.announce();
    return agent;
  }

  static restore(row: AgentRow): Agent {
    return new Agent(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get name(): string {
    return this.row.name;
  }

  get role(): string {
    return this.row.role;
  }

  get tool(): string {
    return this.row.tool;
  }

  get scopes(): readonly string[] {
    return this.row.scopes;
  }

  get monthlyLimit(): number | null {
    return this.row.monthly_limit;
  }

  get paused(): boolean {
    return this.row.status === Agent.PAUSED;
  }

  /** 주인이 고친 칸을 적는다 */
  edit(changes: Partial<AgentRow>): void {
    this.accept(changes, Agent.RULES);
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
    const limit = this.row.monthly_limit;
    return !this.paused && limit !== null && usedThisMonth > limit;
  }

  /**
   * 새 일을 받지 않고 쉬는가. 지난 5시간 토큰이나 구독 사용률이 정한 값에 닿으면 쉰다.
   * 결재도 상태 변경도 없고, 달리는 작업은 끝까지 간다. 시간이 지나 값이 내려가면 저절로 다시 일한다.
   * planPercent가 null이면 확인 전이라 토큰 한도만 본다.
   */
  holds(fiveHourTokens: number, planPercent: number | null): boolean {
    const { five_hour_limit: tokens, plan_stop_percent: percent } = this.row;
    const tokensFull = tokens !== null && fiveHourTokens >= tokens;
    const planFull = percent !== null && planPercent !== null && planPercent >= percent;
    return tokensFull || planFull;
  }

  /** 한도 올리기 결재가 승인됨: 한도를 두 배로 하고 다시 움직인다 */
  raiseLimit(): void {
    const limit = this.row.monthly_limit;
    if (limit !== null) this.edit({ monthly_limit: limit * 2 });
    this.resume();
  }

  /** 이 에이전트가 결재를 올릴 수 있는 동작인가. 주인이 정해 둔 동작만 */
  assertMayRequest(action: string): void {
    if (!this.row.approval_actions.includes(action))
      throw new Forbidden(action, `이 에이전트에게 맡기지 않은 동작이에요: ${action}`);
  }

  view(): AgentView {
    return new AgentView(this.row);
  }

  usageView(fiveHourTokens: number, monthTokens: number, holding: boolean): AgentUsageView {
    return new AgentUsageView(this.row, fiveHourTokens, monthTokens, holding);
  }

  private moveTo(status: string): void {
    if (this.row.status === status) return;
    this.put('status', status);
    this.announce();
  }

  private announce(): void {
    this.record(
      new DomainEvent('task.agent.changed', 1, this.spaceId, {
        agentId: this.id,
        status: this.row.status,
      }),
    );
  }
}

/** 에이전트 하나의 지금 사용량. 쉬는지는 Agent가 정한다 */
export class AgentUsage {
  constructor(
    readonly agent: Agent,
    readonly fiveHourTokens: number,
    readonly monthTokens: number,
    /** 유효한 창 중 가장 높은 구독 사용률. 확인 전이면 null */
    readonly planPercent: number | null,
  ) {}

  get holding(): boolean {
    return this.agent.holds(this.fiveHourTokens, this.planPercent);
  }

  /** 새 일을 줄 수 있는가 */
  get ready(): boolean {
    return !this.agent.paused && !this.holding;
  }

  view(): AgentUsageView {
    return this.agent.usageView(this.fiveHourTokens, this.monthTokens, this.holding);
  }
}
