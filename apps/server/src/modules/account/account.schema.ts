// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 조건 규칙(platform/base의 TableQuery)이 쓰는 Drizzle 표: 표 이름 · 칸 · 행 타입. 칸 이름은 DB 그대로다.
// drizzle-orm을 직접 가져오는 곳은 이 생성 파일들과 platform/base뿐이다 (모듈 경계 검사).
import { boolean, customType, inet, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const byteaColumn = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const accountSchema = pgSchema('account');

/** account.device_tokens */
export const deviceTokens = accountSchema.table('device_tokens', {
  id: uuid('id').notNull(),
  device_id: uuid('device_id').notNull(),
  token_hash: text('token_hash').notNull(),
  prefix: text('prefix').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** account.devices */
export const devices = accountSchema.table('devices', {
  id: uuid('id').notNull(),
  space_id: uuid('space_id').notNull(),
  user_id: uuid('user_id'),
  name: text('name').notNull(),
  scopes: text('scopes').array().notNull(),
  is_primary_tidy: boolean('is_primary_tidy').notNull(),
  meta: jsonb('meta').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  last_seen_at: timestamp('last_seen_at', { withTimezone: true }),
  last_ip: inet('last_ip'),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  version: integer('version').notNull(),
});

/** account.login_links */
export const loginLinks = accountSchema.table('login_links', {
  method: text('method').notNull(),
  subject: text('subject').notNull(),
  user_id: uuid('user_id').notNull(),
  label: text('label'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** account.oauth_clients */
export const oauthClients = accountSchema.table('oauth_clients', {
  client_id: text('client_id').notNull(),
  space_id: uuid('space_id').notNull(),
  client_name: text('client_name'),
  redirect_uris: text('redirect_uris').array().notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** account.oauth_codes */
export const oauthCodes = accountSchema.table('oauth_codes', {
  code_hash: text('code_hash').notNull(),
  client_id: text('client_id').notNull(),
  device_draft: jsonb('device_draft').notNull(),
  code_challenge: text('code_challenge').notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  used_at: timestamp('used_at', { withTimezone: true }),
  redirect_uri: text('redirect_uri').notNull(),
});

/** account.oauth_tokens */
export const oauthTokens = accountSchema.table('oauth_tokens', {
  id: uuid('id').notNull(),
  device_id: uuid('device_id').notNull(),
  client_id: text('client_id'),
  kind: text('kind').notNull(),
  token_hash: text('token_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** account.secrets */
export const secrets = accountSchema.table('secrets', {
  space_id: uuid('space_id').notNull(),
  key: text('key').notNull(),
  ciphertext: byteaColumn('ciphertext').notNull(),
  nonce: byteaColumn('nonce').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** account.settings */
export const settings = accountSchema.table('settings', {
  space_id: uuid('space_id').notNull(),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** account.space_members */
export const spaceMembers = accountSchema.table('space_members', {
  space_id: uuid('space_id').notNull(),
  user_id: uuid('user_id').notNull(),
  role: text('role').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
});

/** account.spaces */
export const spaces = accountSchema.table('spaces', {
  id: uuid('id').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  logo_blob_hash: text('logo_blob_hash'),
});

/** account.users */
export const users = accountSchema.table('users', {
  id: uuid('id').notNull(),
  display_name: text('display_name'),
  avatar_url: text('avatar_url'),
  email: text('email'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  login: text('login').notNull(),
  password_hash: text('password_hash'),
  password_changed_at: timestamp('password_changed_at', { withTimezone: true }),
  version: integer('version').notNull(),
});

/** account.web_sessions */
export const webSessions = accountSchema.table('web_sessions', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  token_hash: text('token_hash').notNull(),
  ip: inet('ip'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
});
