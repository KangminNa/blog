// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { bigint, boolean, customType, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const byteaColumn = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const taskSchema = pgSchema('task');

/** task.agent_revisions */
export const agentRevisions = taskSchema.table('agent_revisions', {
  id: uuid('id').notNull(),
  agent_id: uuid('agent_id').notNull(),
  revision: integer('revision').notNull(),
  settings: jsonb('settings').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** task.agents */
export const agents = taskSchema.table('agents', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  tool: text('tool').notNull(),
  scopes: text('scopes').array().notNull(),
  approval_actions: text('approval_actions').array().notNull(),
  monthly_limit: bigint('monthly_limit', { mode: 'number' }),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  five_hour_limit: bigint('five_hour_limit', { mode: 'number' }),
  plan_stop_percent: integer('plan_stop_percent'),
  reports_to: uuid('reports_to'),
  settings_revision: integer('settings_revision').notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  runner_id: uuid('runner_id'),
});

/** task.ai_logins */
export const aiLogins = taskSchema.table('ai_logins', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  tool: text('tool').notNull(),
  secret: byteaColumn('secret').notNull(),
  nonce: byteaColumn('nonce').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  checked_at: timestamp('checked_at', { withTimezone: true }),
  last_error: text('last_error'),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** task.approvals */
export const approvals = taskSchema.table('approvals', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  task_id: uuid('task_id'),
  agent_id: uuid('agent_id'),
  action: text('action').notNull(),
  target_kind: text('target_kind').notNull(),
  target_id: uuid('target_id').notNull(),
  target_version: integer('target_version').notNull(),
  status: text('status').notNull(),
  decided_by: uuid('decided_by'),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  note: text('note'),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** task.chats */
export const chats = taskSchema.table('chats', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  agent_id: uuid('agent_id').notNull(),
  title: text('title').notNull(),
  turns: integer('turns').notNull(),
  request_id: text('request_id').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** task.goal_rounds */
export const goalRounds = taskSchema.table('goal_rounds', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  run_id: uuid('run_id').notNull(),
  round: integer('round').notNull(),
  task_id: uuid('task_id').notNull(),
  summary: text('summary').notNull(),
  completed: text('completed').array().notNull(),
  remaining: text('remaining').array().notNull(),
  evidence: jsonb('evidence').notNull(),
  next_plan: text('next_plan').notNull(),
  done: boolean('done').notNull(),
  milestone: boolean('milestone').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** task.goal_runs */
export const goalRuns = taskSchema.table('goal_runs', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  goal_id: uuid('goal_id').notNull(),
  agent_id: uuid('agent_id').notNull(),
  title: text('title').notNull(),
  instruction: text('instruction').notNull(),
  criteria: text('criteria').array().notNull(),
  checkpoint: text('checkpoint').notNull(),
  round: integer('round').notNull(),
  max_rounds: integer('max_rounds').notNull(),
  status: text('status').notNull(),
  request_id: text('request_id').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
});

/** task.goals */
export const goals = taskSchema.table('goals', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  parent_id: uuid('parent_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull(),
  sort: integer('sort').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** task.outputs */
export const outputs = taskSchema.table('outputs', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  task_id: uuid('task_id'),
  run_id: uuid('run_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  mime: text('mime').notNull(),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  blob_hash: text('blob_hash').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  purge_after: timestamp('purge_after', { withTimezone: true }),
});

/** task.plan_usage */
export const planUsage = taskSchema.table('plan_usage', {
  space_id: uuid('space_id').notNull(),
  tool: text('tool').notNull(),
  period: text('period').notNull(),
  percent: integer('percent').notNull(),
  resets_at: timestamp('resets_at', { withTimezone: true }).notNull(),
  status: text('status'),
  seen_at: timestamp('seen_at', { withTimezone: true }).notNull(),
});

/** task.runners */
export const runners = taskSchema.table('runners', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  device_id: uuid('device_id').notNull(),
  accepting: boolean('accepting').notNull(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  sandbox: boolean('sandbox').notNull(),
});

/** task.schedules */
export const schedules = taskSchema.table('schedules', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  title: text('title').notNull(),
  agent_id: uuid('agent_id'),
  mode: text('mode').notNull(),
  at_minute: integer('at_minute'),
  weekdays: integer('weekdays').array().notNull(),
  every_hours: integer('every_hours'),
  time_zone: text('time_zone').notNull(),
  instruction: text('instruction').notNull(),
  goal_id: uuid('goal_id'),
  daily_max: integer('daily_max').notNull(),
  run_day: text('run_day'),
  day_runs: integer('day_runs').notNull(),
  enabled: boolean('enabled').notNull(),
  next_run_at: timestamp('next_run_at', { withTimezone: true }),
  last_run_at: timestamp('last_run_at', { withTimezone: true }),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** task.skill_revisions */
export const skillRevisions = taskSchema.table('skill_revisions', {
  id: uuid('id').notNull(),
  skill_id: uuid('skill_id').notNull(),
  revision: integer('revision').notNull(),
  files: jsonb('files').notNull(),
  hash: text('hash').notNull(),
  based_on: text('based_on').notNull(),
  note: text('note').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** task.skills */
export const skills = taskSchema.table('skills', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  active_revision: integer('active_revision'),
  revisions: integer('revisions').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** task.task_events */
export const taskEvents = taskSchema.table('task_events', {
  id: bigint('id', { mode: 'number' }).notNull(),
  task_id: uuid('task_id').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  kind: text('kind').notNull(),
  body: text('body').notNull(),
  tokens: integer('tokens').notNull(),
});

/** task.task_runs */
export const taskRuns = taskSchema.table('task_runs', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  task_id: uuid('task_id').notNull(),
  seq: integer('seq').notNull(),
  runner_id: uuid('runner_id').notNull(),
  agent_id: uuid('agent_id'),
  agent_revision: integer('agent_revision'),
  skill: text('skill'),
  skill_source: text('skill_source'),
  skill_revision: integer('skill_revision'),
  skill_hash: text('skill_hash'),
  runner_build: text('runner_build'),
  cli_version: text('cli_version'),
  model: text('model'),
  started_at: timestamp('started_at', { withTimezone: true }).notNull(),
});

/** task.tasks */
export const tasks = taskSchema.table('tasks', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  agent_id: uuid('agent_id'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  instruction: text('instruction').notNull(),
  payload: jsonb('payload').notNull(),
  result: jsonb('result'),
  target_kind: text('target_kind'),
  target_id: uuid('target_id'),
  base_version: integer('base_version'),
  status: text('status').notNull(),
  priority: integer('priority').notNull(),
  lease_until: timestamp('lease_until', { withTimezone: true }),
  leased_by: uuid('leased_by'),
  attempts: integer('attempts').notNull(),
  request_id: text('request_id'),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
  goal_id: uuid('goal_id'),
  parent_id: uuid('parent_id'),
  depth: integer('depth').notNull(),
  wait_reason: text('wait_reason'),
  rounds: integer('rounds').notNull(),
});
