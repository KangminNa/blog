// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** platform.blobs */
export interface BlobRow {
  hash: string;
  mime: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  storage_key: string;
  created_at: Date;
}
export type BlobNew = Partial<BlobRow> & Pick<BlobRow, 'hash' | 'mime' | 'size_bytes' | 'storage_key'>;

/** platform.idempotency */
export interface IdempotencyRow {
  device_id: string;
  request_id: string;
  tool: string;
  response: unknown;
  created_at: Date;
}
export type IdempotencyNew = Partial<IdempotencyRow> & Pick<IdempotencyRow, 'device_id' | 'request_id' | 'tool' | 'response'>;

/** platform.notice_settings */
export interface NoticeSettingRow {
  space_id: string;
  digest: string;
  digest_minute: number;
  quiet_start: number | null;
  quiet_end: number | null;
  time_zone: string;
  routes: unknown;
  version: number;
  updated_at: Date;
}
export type NoticeSettingNew = Partial<NoticeSettingRow> & Pick<NoticeSettingRow, 'space_id'>;

/** platform.notifications */
export interface NotificationRow {
  id: string;
  space_id: string;
  kind: string;
  severity: string;
  group_key: string | null;
  title: string;
  body: string | null;
  link: string | null;
  data: unknown;
  created_at: Date;
  read_at: Date | null;
  push_sent_at: Date | null;
}
export type NotificationNew = Partial<NotificationRow> & Pick<NotificationRow, 'id' | 'space_id' | 'kind' | 'severity' | 'title'>;

/** platform.outbox */
export interface OutboxRow {
  id: number;
  space_id: string;
  topic: string;
  payload: unknown;
  created_at: Date;
  processed_at: Date | null;
  attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  failed_at: Date | null;
}
export type OutboxNew = Partial<OutboxRow> & Pick<OutboxRow, 'id' | 'space_id' | 'topic'>;

/** platform.plugin_settings */
export interface PluginSettingRow {
  plugin: string;
  key: string;
  value: string | null;
  secret_ciphertext: Buffer | null;
  secret_nonce: Buffer | null;
  updated_at: Date;
  updated_by: string | null;
}
export type PluginSettingNew = Partial<PluginSettingRow> & Pick<PluginSettingRow, 'plugin' | 'key'>;

/** platform.plugins */
export interface PluginRow {
  name: string;
  enabled: boolean;
  version: string;
  granted_uses: readonly string[];
  enabled_at: Date | null;
  updated_at: Date;
  updated_by: string | null;
}
export type PluginNew = Partial<PluginRow> & Pick<PluginRow, 'name' | 'version'>;

/** platform.push_subscriptions */
export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: Date;
  last_success_at: Date | null;
  fail_count: number;
  space_id: string;
}
export type PushSubscriptionNew = Partial<PushSubscriptionRow> & Pick<PushSubscriptionRow, 'id' | 'user_id' | 'endpoint' | 'p256dh' | 'auth' | 'space_id'>;
