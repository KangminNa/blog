// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** task.agents */
export interface AgentRow {
  id: string;
  space_id: string;
  name: string;
  role: string;
  tool: string;
  scopes: readonly string[];
  approval_actions: readonly string[];
  monthly_limit: number | null;
  status: string;
  version: number;
  created_at: Date;
  five_hour_limit: number | null;
  plan_stop_percent: number | null;
  reports_to: string | null;
}
export type AgentNew = Partial<AgentRow> & Pick<AgentRow, 'id' | 'space_id' | 'name' | 'tool'>;

/** task.ai_logins */
export interface AiLoginRow {
  id: string;
  space_id: string;
  tool: string;
  secret: Buffer;
  nonce: Buffer;
  expires_at: Date | null;
  checked_at: Date | null;
  last_error: string | null;
  version: number;
  created_at: Date;
}
export type AiLoginNew = Partial<AiLoginRow> & Pick<AiLoginRow, 'id' | 'space_id' | 'tool' | 'secret' | 'nonce'>;

/** task.approvals */
export interface ApprovalRow {
  id: string;
  space_id: string;
  task_id: string | null;
  agent_id: string | null;
  action: string;
  target_kind: string;
  target_id: string;
  target_version: number;
  status: string;
  decided_by: string | null;
  decided_at: Date | null;
  note: string | null;
  version: number;
  created_at: Date;
}
export type ApprovalNew = Partial<ApprovalRow> & Pick<ApprovalRow, 'id' | 'space_id' | 'action' | 'target_kind' | 'target_id' | 'target_version'>;

/** task.goals */
export interface GoalRow {
  id: string;
  space_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  status: string;
  sort: number;
  version: number;
  created_at: Date;
}
export type GoalNew = Partial<GoalRow> & Pick<GoalRow, 'id' | 'space_id' | 'title'>;

/** task.heartbeats */
export interface HeartbeatRow {
  id: string;
  space_id: string;
  agent_id: string;
  mode: string;
  at_minute: number | null;
  weekdays: readonly number[];
  every_hours: number | null;
  time_zone: string;
  instruction: string;
  goal_id: string | null;
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  version: number;
  created_at: Date;
}
export type HeartbeatNew = Partial<HeartbeatRow> & Pick<HeartbeatRow, 'id' | 'space_id' | 'agent_id' | 'mode' | 'time_zone'>;

/** task.plan_usage */
export interface PlanUsageRow {
  space_id: string;
  tool: string;
  period: string;
  percent: number;
  resets_at: Date;
  status: string | null;
  seen_at: Date;
}
export type PlanUsageNew = Partial<PlanUsageRow> & Pick<PlanUsageRow, 'space_id' | 'tool' | 'period' | 'percent' | 'resets_at'>;

/** task.runners */
export interface RunnerRow {
  id: string;
  space_id: string;
  device_id: string;
  accepting: boolean;
  last_seen_at: Date;
  version: number;
  created_at: Date;
}
export type RunnerNew = Partial<RunnerRow> & Pick<RunnerRow, 'id' | 'space_id' | 'device_id'>;

/** task.task_events */
export interface TaskEventRow {
  id: number;
  task_id: string;
  at: Date;
  kind: string;
  body: string;
  tokens: number;
}
export type TaskEventNew = Partial<TaskEventRow> & Pick<TaskEventRow, 'id' | 'task_id' | 'kind'>;

/** task.tasks */
export interface TaskRow {
  id: string;
  space_id: string;
  agent_id: string | null;
  kind: string;
  title: string;
  instruction: string;
  payload: unknown;
  result: unknown | null;
  target_kind: string | null;
  target_id: string | null;
  base_version: number | null;
  status: string;
  priority: number;
  lease_until: Date | null;
  leased_by: string | null;
  attempts: number;
  request_id: string | null;
  version: number;
  created_at: Date;
  finished_at: Date | null;
  goal_id: string | null;
  parent_id: string | null;
  depth: number;
  wait_reason: string | null;
  rounds: number;
}
export type TaskNew = Partial<TaskRow> & Pick<TaskRow, 'id' | 'space_id' | 'kind' | 'title'>;
