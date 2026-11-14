// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const mcpSchema = pgSchema('mcp');

/** mcp.tool_text_revisions */
export const toolTextRevisions = mcpSchema.table('tool_text_revisions', {
  id: uuid('id').notNull(),
  tool_text_id: uuid('tool_text_id').notNull(),
  revision: integer('revision').notNull(),
  description: text('description').notNull(),
  input: jsonb('input').notNull(),
  based_on: text('based_on').notNull(),
  note: text('note').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** mcp.tool_texts */
export const toolTexts = mcpSchema.table('tool_texts', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  tool: text('tool').notNull(),
  active_revision: integer('active_revision'),
  revisions: integer('revisions').notNull(),
  version: integer('version').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});
