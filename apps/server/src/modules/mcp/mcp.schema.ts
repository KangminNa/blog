// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { bigint, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const mcpSchema = pgSchema('mcp');

/** mcp.mcp_reads */
export const mcpReads = mcpSchema.table('mcp_reads', {
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  id: bigint('id', { mode: 'number' }).notNull(),
  space_id: uuid('space_id').notNull(),
  device_id: uuid('device_id'),
  tool: text('tool').notNull(),
  query: jsonb('query').notNull(),
  result_count: integer('result_count'),
});
