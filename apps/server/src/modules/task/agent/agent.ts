import {
  Actor,
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  Forbidden,
  RuleViolation,
  TableEntity,
} from '../../platform';
import { JobTeamMemberView } from '../task/task.view';
import type { AgentNew, AgentRevisionNew, AgentRow } from '../task.tables';
import { AgentUsageView } from '../usage/usage.view';
import { AgentSavedView } from './agent.view';

// 일을 맡는 에이전트. 할 수 있는 일(scopes)과 결재를 올려 할 수 있는 동작(approval_actions), 토큰 한도를 가진다.
// 주인이 정하는 칸은 RULES를 지나서만 바뀌고, 멈춤·다시 시작은 메서드로만 바뀐다.
// 한 달 한도는 넘기면 멈추고 결재를 받는다. 5시간 한도와 구독 사용률은 닿으면 새 일만 쉬고 시간이 지나면 저절로 돌아온다 (holds).
// 조직도: 보고 대상(reports_to)이 없으면 주인에게 보고한다. 보고 대상은 reportTo로만 바꾼다 (순환 · 깊이 검사).
export class Agent extends TableEntity<AgentRow, AgentNew> {
  /** 이번 저장에서 쌓을 설정 판 */
  private pendingRevision: AgentRevisionNew | null = null;
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
    Actor.BROWSE,
    Actor.CODE,
  ];
  /** browse와 함께 줄 수 없는 권한: 비공개(세션 · wiki)와 임시 글 · 소재를 여는 것. DB CHECK agents_browse_not_private와 같다 */
  private static readonly NOT_WITH_BROWSE: readonly string[] = [Actor.READ_ALL, Actor.WRITE];
  /** code와 함께 줄 수 없는 권한: 비공개 지식과 코드 작업을 섞지 않는다. DB CHECK agents_code_not_private와 같다 */
  private static readonly NOT_WITH_CODE: readonly string[] = [Actor.READ_ALL, Actor.WRITE];
  /** 설정 판에 남기는 칸: 주인이 정하는 것 전부 (상태 · 사용량은 빼고) */
  private static readonly SETTINGS: readonly (keyof AgentRow)[] = [
    'name',
    'role',
    'tool',
    'scopes',
    'approval_actions',
    'monthly_limit',
    'five_hour_limit',
    'plan_stop_percent',
    'reports_to',
  ];
  private static readonly NAME_MAX = 60;
  private static readonly ROLE_MAX = 2000;
  private static readonly PLAN_PERCENT_MAX = 100;
  /** 조직도의 깊이 한도. 주인 바로 아래가 1단계 */
  static readonly ORG_DEPTH_MAX = 4;
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
      // 로그인된 브라우저 + 비공개 + 밖으로 보내기가 한 에이전트에 모이지 않게 (브라우저 작업은 비공개를 못 읽는다).
      // write도 임시 글 본문과 소재 메모를 연다 (blog_get_post · basket_get). 재료는 지시문으로 받는다
      if (value.includes(Actor.BROWSE) && Agent.NOT_WITH_BROWSE.some((s) => value.includes(s)))
        throw new RuleViolation(
          '브라우저 사용은 전체 읽기 · 초안 작성과 함께 줄 수 없어요 (browse · read_all · write)',
        );
      // 셸이 있는 칸 + 비공개가 한 에이전트에 모이지 않게: 저장소 파일에 심은 지시문에 속아도 비공개를 내보내지 못한다
      if (value.includes(Actor.CODE) && Agent.NOT_WITH_CODE.some((s) => value.includes(s)))
        throw new RuleViolation(
          '코드 작업은 전체 읽기 · 초안 작성과 함께 줄 수 없어요 (code · read_all · write)',
        );
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

  /** 새 에이전트의 빈 칸. 이 순서로 규칙을 지난다 */
  private static readonly BLANK: Partial<AgentRow> = {
    name: '',
    role: '',
    tool: '',
    scopes: [],
    approval_actions: [],
    monthly_limit: null,
    five_hour_limit: null,
    plan_stop_percent: null,
  };

  /** 새 에이전트. fields는 주인이 정한 칸이고, 보고 대상은 reportTo로 정한다 */
  static open(spaceId: string, fields: Partial<AgentRow>, now: Date): Agent {
    const agent = new Agent(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        name: '',
        tool: '',
        reports_to: null,
        status: Agent.ACTIVE,
        created_at: now,
      },
      true,
    );
    agent.edit({ ...Agent.BLANK, ...fields });
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

  /** 주인이 고친 칸을 적는다. 설정이 바뀌면 설정 판을 하나 올린다 */
  edit(changes: Partial<AgentRow>): void {
    const before = this.settingsSnapshot();
    this.accept(changes, Agent.RULES);
    this.noteSettings(before);
  }

  /** 지금 설정 판 (실행 기록에 남긴다) */
  get settingsRevision(): number {
    return this.row.settings_revision ?? 1;
  }

  /** 이번에 쌓을 설정 판 (Repository가 넣는다) */
  get addedRevision(): AgentRevisionNew | null {
    return this.pendingRevision;
  }

  /** 설정 칸 전부 (판의 내용) */
  private settingsSnapshot(): Record<string, unknown> {
    return Object.fromEntries(Agent.SETTINGS.map((column) => [column, this.row[column] ?? null]));
  }

  /**
   * 설정이 바뀌었으면 판을 쌓는다. 새 에이전트는 판 1. 한 번의 저장 안에서 여러 번 바뀌면(고치기 + 보고 대상)
   * 판은 하나만 올리고 마지막 모습을 남긴다
   */
  private noteSettings(before: Record<string, unknown>): void {
    const after = this.settingsSnapshot();
    if (!this.isNew && JSON.stringify(after) === JSON.stringify(before)) return;
    const revision = this.pendingRevision?.revision ?? (this.isNew ? 1 : this.settingsRevision + 1);
    if (revision !== this.row.settings_revision) this.put('settings_revision', revision);
    this.pendingRevision = { id: BaseEntity.newId(), agent_id: this.id, revision, settings: after };
  }

  /**
   * 보고 대상을 바꾼다. null이면 주인에게 보고한다. org는 공간의 모든 에이전트다 (바꾸는 쪽이 모두 잠근 것).
   * 자기 자신이나 자기 아래 팀원에게 보고하면 순환이라 막고, 바꾼 뒤 가장 깊은 팀원이 ORG_DEPTH_MAX를 넘으면 막는다.
   */
  reportTo(managerId: string | null, org: readonly Agent[]): void {
    let level = 1;
    if (managerId !== null) {
      const manager = org.find((a) => a.id === managerId);
      if (!manager) throw new RuleViolation('보고 대상 에이전트가 없어요');
      const above = Agent.chainUp(manager, org);
      if (above.some((a) => a.id === this.id))
        throw new RuleViolation('자기 자신이나 자기 팀원에게는 보고할 수 없어요');
      level = above.length + 1;
    }
    if (level + Agent.heightOf(this.id, org) - 1 > Agent.ORG_DEPTH_MAX)
      throw new RuleViolation(`조직도는 ${Agent.ORG_DEPTH_MAX}단계까지예요`);
    if (managerId === this.row.reports_to) return;
    const before = this.settingsSnapshot();
    this.put('reports_to', managerId);
    this.noteSettings(before);
  }

  /** 이 에이전트의 바로 아래 팀원인가 (위임은 바로 아래에게만) */
  manages(other: Agent): boolean {
    return other.row.reports_to === this.id;
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

  view(): AgentSavedView {
    return new AgentSavedView(this.row);
  }

  usageView(fiveHourTokens: number, monthTokens: number, holding: boolean): AgentUsageView {
    return new AgentUsageView(this.row, fiveHourTokens, monthTokens, holding);
  }

  /** 팀장이 받는 일에 실리는 팀원 하나. kinds는 이 팀원에게 맡길 수 있는 일의 종류 */
  memberView(kinds: readonly string[]): JobTeamMemberView {
    return new JobTeamMemberView(this.row, kinds);
  }

  /** agent부터 맨 위까지 (agent 포함). 저장된 조직도에 순환이 없어도 org 수만큼만 따라간다 */
  private static chainUp(agent: Agent, org: readonly Agent[]): readonly Agent[] {
    const chain = [agent];
    for (let at = agent; at.row.reports_to !== null && chain.length <= org.length; ) {
      const boss = org.find((a) => a.id === at.row.reports_to);
      if (!boss) break;
      chain.push(boss);
      at = boss;
    }
    return chain;
  }

  /** id부터 가장 깊은 팀원까지의 단계 수 (팀원이 없으면 1) */
  private static heightOf(id: string, org: readonly Agent[], seen = new Set<string>()): number {
    if (seen.has(id)) return 1;
    seen.add(id);
    const team = org.filter((a) => a.row.reports_to === id);
    return 1 + Math.max(0, ...team.map((a) => Agent.heightOf(a.id, org, seen)));
  }

  private moveTo(status: string): void {
    if (this.row.status === status) return;
    this.put('status', status);
    this.announce();
  }

  private announce(): void {
    this.record(
      new DomainEvent('task.agent.changed', 1, this.row.space_id, {
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
