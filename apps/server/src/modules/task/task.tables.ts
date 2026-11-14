// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** task.agent_revisions */
export interface AgentRevisionRow {
  id: string;
  agent_id: string;
  revision: number;
  settings: unknown;
  created_at: Date;
}
export type AgentRevisionNew = Partial<AgentRevisionRow> & Pick<AgentRevisionRow, 'id' | 'agent_id' | 'revision' | 'settings'>;

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
  settings_revision: number;
  deleted_at: Date | null;
  runner_id: string | null;
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

/** task.chats */
export interface ChatRow {
  id: string;
  space_id: string;
  agent_id: string;
  title: string;
  turns: number;
  request_id: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  device_id: string | null;
}
export type ChatNew = Partial<ChatRow> & Pick<ChatRow, 'id' | 'space_id' | 'agent_id' | 'title' | 'request_id'>;

/** task.goal_rounds */
export interface GoalRoundRow {
  id: string;
  space_id: string;
  run_id: string;
  round: number;
  task_id: string;
  summary: string;
  completed: readonly string[];
  remaining: readonly string[];
  evidence: unknown;
  next_plan: string;
  done: boolean;
  milestone: boolean;
  created_at: Date;
}
export type GoalRoundNew = Partial<GoalRoundRow> & Pick<GoalRoundRow, 'id' | 'space_id' | 'run_id' | 'round' | 'task_id' | 'summary' | 'done' | 'milestone'>;

/** task.goal_runs */
export interface GoalRunRow {
  id: string;
  space_id: string;
  goal_id: string;
  agent_id: string;
  title: string;
  instruction: string;
  criteria: readonly string[];
  checkpoint: string;
  round: number;
  max_rounds: number;
  status: string;
  request_id: string;
  version: number;
  created_at: Date;
  finished_at: Date | null;
}
export type GoalRunNew = Partial<GoalRunRow> & Pick<GoalRunRow, 'id' | 'space_id' | 'goal_id' | 'agent_id' | 'title' | 'instruction' | 'checkpoint' | 'max_rounds' | 'status' | 'request_id'>;

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

/** task.outputs */
export interface OutputRow {
  id: string;
  space_id: string;
  task_id: string | null;
  run_id: string | null;
  name: string;
  kind: string;
  mime: string;
  size_bytes: number;
  blob_hash: string;
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  purge_after: Date | null;
}
export type OutputNew = Partial<OutputRow> & Pick<OutputRow, 'id' | 'space_id' | 'name' | 'kind' | 'mime' | 'size_bytes' | 'blob_hash'>;

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
  sandbox: boolean;
}
export type RunnerNew = Partial<RunnerRow> & Pick<RunnerRow, 'id' | 'space_id' | 'device_id'>;

/** task.schedules */
export interface ScheduleRow {
  id: string;
  space_id: string;
  title: string;
  agent_id: string | null;
  mode: string;
  at_minute: number | null;
  weekdays: readonly number[];
  every_hours: number | null;
  time_zone: string;
  instruction: string;
  goal_id: string | null;
  daily_max: number;
  run_day: string | null;
  day_runs: number;
  enabled: boolean;
  next_run_at: Date | null;
  last_run_at: Date | null;
  version: number;
  created_at: Date;
}
export type ScheduleNew = Partial<ScheduleRow> & Pick<ScheduleRow, 'id' | 'space_id' | 'title' | 'mode' | 'time_zone'>;

/** task.skill_revisions */
export interface SkillRevisionRow {
  id: string;
  skill_id: string;
  revision: number;
  files: unknown;
  hash: string;
  based_on: string;
  note: string;
  created_at: Date;
}
export type SkillRevisionNew = Partial<SkillRevisionRow> & Pick<SkillRevisionRow, 'id' | 'skill_id' | 'revision' | 'files' | 'hash' | 'based_on'>;

/** task.skills */
export interface SkillRow {
  id: string;
  space_id: string;
  name: string;
  active_revision: number | null;
  revisions: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}
export type SkillNew = Partial<SkillRow> & Pick<SkillRow, 'id' | 'space_id' | 'name'>;

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

/** task.task_runs */
export interface TaskRunRow {
  id: string;
  space_id: string;
  task_id: string;
  seq: number;
  runner_id: string;
  agent_id: string | null;
  agent_revision: number | null;
  skill: string | null;
  skill_source: string | null;
  skill_revision: number | null;
  skill_hash: string | null;
  runner_build: string | null;
  cli_version: string | null;
  model: string | null;
  started_at: Date;
  prompt_source: string | null;
  prompt_revision: number | null;
  prompt_hash: string | null;
}
export type TaskRunNew = Partial<TaskRunRow> & Pick<TaskRunRow, 'id' | 'space_id' | 'task_id' | 'seq' | 'runner_id'>;

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
