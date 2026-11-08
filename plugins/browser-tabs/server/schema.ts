// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { TableColumns } from '../../../apps/server/src/plugin-api';

const { integer, pgSchema, text, timestamp, uuid } = TableColumns;

const browserTabsSchema = pgSchema('browser_tabs');

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
