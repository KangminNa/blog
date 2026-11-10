// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { TableColumns } from '../../../apps/server/src/plugin-api';

const { integer, jsonb, pgSchema, text, timestamp, uuid } = TableColumns;

const codeGithubSchema = pgSchema('code_github');

/** code_github.pulls */
export const pulls = codeGithubSchema.table('pulls', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  repo_id: uuid('repo_id').notNull(),
  task_id: uuid('task_id').notNull(),
  branch: text('branch').notNull(),
  number: integer('number').notNull(),
  url: text('url').notNull(),
  head_sha: text('head_sha').notNull(),
  checks: jsonb('checks').notNull(),
  status: text('status').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** code_github.repos */
export const repos = codeGithubSchema.table('repos', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  base: text('base').notNull(),
  setup: text('setup').notNull(),
  checks: text('checks').array().notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  archived_at: timestamp('archived_at', { withTimezone: true }),
});
