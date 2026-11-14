// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { TableColumns } from '../../../apps/server/src/plugin-api';

const { customType, integer, jsonb, pgSchema, text, timestamp, uuid } = TableColumns;

const byteaColumn = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const browserTabsSchema = pgSchema('browser_tabs');

/** browser_tabs.clicks */
export const clicks = browserTabsSchema.table('clicks', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  task_id: uuid('task_id').notNull(),
  site_id: uuid('site_id').notNull(),
  runner_id: uuid('runner_id').notNull(),
  tab_id: text('tab_id').notNull(),
  page_url: text('page_url').notNull(),
  page_title: text('page_title').notNull(),
  role: text('role').notNull(),
  name: text('name').notNull(),
  nth: integer('nth').notNull(),
  box: jsonb('box').notNull(),
  fingerprint: text('fingerprint').notNull(),
  note: text('note'),
  status: text('status').notNull(),
  approval_id: uuid('approval_id'),
  reason: text('reason'),
  after_url: text('after_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  decided_at: timestamp('decided_at', { withTimezone: true }),
  clicked_at: timestamp('clicked_at', { withTimezone: true }),
  version: integer('version').notNull(),
});

/** browser_tabs.reads */
export const reads = browserTabsSchema.table('reads', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  url: text('url').notNull(),
  status: text('status').notNull(),
  title: text('title'),
  body: text('body'),
  error: text('error'),
  requested_at: timestamp('requested_at', { withTimezone: true }).notNull(),
  read_at: timestamp('read_at', { withTimezone: true }),
  version: integer('version').notNull(),
});

/** browser_tabs.shots */
export const shots = browserTabsSchema.table('shots', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  task_id: uuid('task_id').notNull(),
  click_id: uuid('click_id'),
  kind: text('kind').notNull(),
  seq: integer('seq').notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  image: byteaColumn('image').notNull(),
  mime: text('mime').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** browser_tabs.sites */
export const sites = browserTabsSchema.table('sites', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  name: text('name').notNull(),
  start_url: text('start_url').notNull(),
  origins: text('origins').array().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  login_needed_at: timestamp('login_needed_at', { withTimezone: true }),
});
