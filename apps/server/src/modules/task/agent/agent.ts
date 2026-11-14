import {
  BaseEntity,
  type ColumnRules,
  DomainEvent,
  Forbidden,
  RuleViolation,
  TableEntity,
} from '../../platform';
import type { Runner } from '../runner/runner';
import { JobTeamMemberView } from '../task/job.view';
import type { AgentNew, AgentRevisionNew, AgentRow } from '../task.tables';
import { AgentUsageView } from '../usage/usage.view';
import { AgentSavedView } from './agent.view';
import { AgentScopes } from './agent-scopes.policy';

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
  /** 에이전트에게 줄 수 있는 권한 (AgentScopes) */
  static readonly SCOPES: readonly string[] = AgentScopes.ALL;
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
    'runner_id',
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
    scopes: (value) => AgentScopes.check(value),
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
        deleted_at: null,
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

  /** 맡는 일: 역할의 첫 줄. 대화의 배정이 이것으로 고른다 (2차 1-5) */
  get duty(): string {
    return this.row.role.trim().split('\n')[0]?.trim() ?? '';
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

  /** 관리자 바로 아래 (보고 대상이 없다). 대화 상대가 될 수 있다 */
  get topLevel(): boolean {
    return this.row.reports_to === null;
  }

  get paused(): boolean {
    return this.row.status === Agent.PAUSED;
  }

  /** 휴지통에 있는지: 목록 · 조직도에서 빠지고 새 일을 받지 않는다 (기록은 남는다). 새로 연 줄(저장 전)과 시험의 줄에는 칸이 없을 수 있어 값이 있을 때만 */
  get deleted(): boolean {
    return this.row.deleted_at instanceof Date;
  }

  /**
   * 휴지통으로 (행은 지우지 않는다: 작업 · 결재 · 설정 판이 이 에이전트를 가리킨다).
   * 바로 아래 팀원은 이 에이전트의 보고 대상(없으면 주인)에게 올리고, 올린 팀원을 돌려준다 (부른 쪽이 저장한다).
   * 진행 중인 작업 · 스케줄 · 목표 실행은 Service가 먼저 본다
   */
  delete(org: readonly Agent[], now: Date): readonly Agent[] {
    if (this.deleted) throw new RuleViolation('이미 삭제한 에이전트예요');
    const team = org.filter((a) => this.manages(a));
    for (const member of team) member.reportTo(this.row.reports_to, org);
    this.put('deleted_at', now);
    this.announce();
    return team;
  }

  /** 휴지통에서 되돌린다. 보고 대상이 그사이 삭제됐으면 주인에게 보고한다 */
  restore(org: readonly Agent[]): void {
    if (!this.deleted) throw new RuleViolation('삭제하지 않은 에이전트예요');
    const boss = org.find((a) => a.id === this.row.reports_to);
    this.put('deleted_at', null);
    if (!boss || boss.deleted) this.reportTo(null, org);
    this.announce();
  }

  /** head와 그 아래 팀 전체, 아래부터 (팀째 지울 때 팀원을 위로 올리지 않게 아래부터 지운다) */
  static teamUnder(head: Agent, org: readonly Agent[]): readonly Agent[] {
    return [...org.filter((a) => head.manages(a)).flatMap((a) => Agent.teamUnder(a, org)), head];
  }

  /**
   * 주인이 고친 칸을 적는다. runner를 주면 일을 맡을 러너도 정한다 (null이면 아무 러너). 설정이 바뀌면 설정 판을 하나 올린다.
   * 묶이면 그 러너만 이 에이전트의 일을 빌리고, 꺼져 있으면 일이 기다린다. 코드 러너 칸에는 묶지 않고,
   * 칸에서만 도는 권한(code · make)이 있으면 묶지 않는다: 묶인 러너가 그 일을 영영 받지 못한다. 다 바꾼 뒤에 한 번 본다
   */
  edit(changes: Partial<AgentRow>, runner?: Runner | null): void {
    const before = this.settingsSnapshot();
    if (runner?.sandbox) throw new RuleViolation('샌드박스에는 묶을 수 없어요');
    if (runner !== undefined) this.put('runner_id', runner?.id ?? null);
    this.accept(changes, Agent.RULES);
    if (this.row.runner_id && AgentScopes.sandboxed(this.row.scopes ?? []))
      throw new RuleViolation(
        '코드 · 만들기 권한이 있는 에이전트는 샌드박스에서만 돌아 러너에 묶을 수 없어요',
      );
    this.noteSettings(before);
  }

  /** 검토자 짝 (2차 2단계): 이 에이전트가 끝낸 대화의 회차를 결재 전에 검토하는 에이전트 */
  get reviewerId(): string | null {
    return this.row.reviewer_id ?? null;
  }

  /**
   * 검토자를 짝짓는다 (null이면 뺀다). 같은 AI가 만들고 검토하면 같은 곳에서 틀려 다른 AI 도구의 에이전트만.
   * 자기 자신 · 지운 에이전트는 안 된다 (DB CHECK agents_reviewer_other)
   */
  pairReviewer(reviewer: Agent | null): void {
    if (reviewer !== null) {
      if (reviewer.id === this.id) throw new RuleViolation('자기 자신은 검토자가 될 수 없어요');
      if (reviewer.deleted) throw new RuleViolation('지운 에이전트는 검토자가 될 수 없어요');
      if (reviewer.tool === this.tool)
        throw new RuleViolation('검토자는 다른 AI 도구를 쓰는 에이전트예요');
    }
    this.put('reviewer_id', reviewer?.id ?? null);
  }

  /** 정해진 러너에 묶였는가 (그 러너만 일을 빌린다) */
  get bound(): boolean {
    return Boolean(this.row.runner_id);
  }

  /** 이 러너(task.runners의 id)가 이 에이전트의 일을 빌릴 수 있는가: 묶이지 않았거나 이 러너에 묶였다 */
  runsOn(runnerId: string): boolean {
    return !this.row.runner_id || this.row.runner_id === runnerId;
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
      if (!manager || manager.deleted) throw new RuleViolation('보고 대상 에이전트가 없어요');
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

  /** 이 에이전트의 바로 아래 팀원인가 (위임은 바로 아래에게만). 삭제한 에이전트는 팀원이 아니다 */
  manages(other: Agent): boolean {
    return other.row.reports_to === this.id && !other.deleted;
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
    const team = org.filter((a) => a.row.reports_to === id && !a.deleted);
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
