// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { bigint, boolean, customType, integer, jsonb, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const byteaColumn = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const platformSchema = pgSchema('platform');

/** platform.blobs */
export const blobs = platformSchema.table('blobs', {
  hash: text('hash').notNull(),
  mime: text('mime').notNull(),
  size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  storage_backend: text('storage_backend').notNull(),
  storage_key: text('storage_key').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** platform.embedding_models */
export const embeddingModels = platformSchema.table('embedding_models', {
  id: smallint('id').notNull(),
  name: text('name').notNull(),
  dims: integer('dims').notNull(),
  provider: text('provider').notNull(),
  is_active: boolean('is_active').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** platform.idempotency */
export const idempotency = platformSchema.table('idempotency', {
  device_id: uuid('device_id').notNull(),
  request_id: text('request_id').notNull(),
  tool: text('tool').notNull(),
  response: jsonb('response').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** platform.notifications */
export const notifications = platformSchema.table('notifications', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  group_key: text('group_key'),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  data: jsonb('data').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  read_at: timestamp('read_at', { withTimezone: true }),
  push_sent_at: timestamp('push_sent_at', { withTimezone: true }),
  email_sent_at: timestamp('email_sent_at', { withTimezone: true }),
  digest_id: uuid('digest_id'),
});

/** platform.outbox */
export const outbox = platformSchema.table('outbox', {
  id: bigint('id', { mode: 'number' }).notNull(),
  space_id: uuid('space_id').notNull(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  processed_at: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull(),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true }),
  last_error: text('last_error'),
  failed_at: timestamp('failed_at', { withTimezone: true }),
});

/** platform.plugin_settings */
export const pluginSettings = platformSchema.table('plugin_settings', {
  plugin: text('plugin').notNull(),
  key: text('key').notNull(),
  value: text('value'),
  secret_ciphertext: byteaColumn('secret_ciphertext'),
  secret_nonce: byteaColumn('secret_nonce'),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  updated_by: text('updated_by'),
});

/** platform.plugins */
export const plugins = platformSchema.table('plugins', {
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull(),
  version: text('version').notNull(),
  granted_uses: text('granted_uses').array().notNull(),
  enabled_at: timestamp('enabled_at', { withTimezone: true }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  updated_by: text('updated_by'),
});

/** platform.push_subscriptions */
export const pushSubscriptions = platformSchema.table('push_subscriptions', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  last_success_at: timestamp('last_success_at', { withTimezone: true }),
  fail_count: integer('fail_count').notNull(),
});
