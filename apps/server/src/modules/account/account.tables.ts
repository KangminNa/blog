// 자동으로 만든 파일이라 고치지 않는다. 마이그레이션 뒤 pnpm db:rows로 다시 만든다 (scripts/db-rows.mjs).
// 표 하나에 인터페이스 하나. 칼럼 이름은 DB 그대로다.
// <이름>New는 새 행에 꼭 적어야 하는 칸이고, 나머지는 DB가 채운다.

/** account.device_tokens */
export interface DeviceTokenRow {
  id: string;
  device_id: string;
  token_hash: string;
  prefix: string;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}
export type DeviceTokenNew = Partial<DeviceTokenRow> & Pick<DeviceTokenRow, 'id' | 'device_id' | 'token_hash' | 'prefix'>;

/** account.devices */
export interface DeviceRow {
  id: string;
  space_id: string;
  user_id: string | null;
  name: string;
  scopes: readonly string[];
  is_primary_tidy: boolean;
  meta: unknown;
  created_at: Date;
  last_seen_at: Date | null;
  last_ip: string | null;
  revoked_at: Date | null;
  version: number;
}
export type DeviceNew = Partial<DeviceRow> & Pick<DeviceRow, 'id' | 'space_id' | 'name'>;

/** account.login_links */
export interface LoginLinkRow {
  method: string;
  subject: string;
  user_id: string;
  label: string | null;
  created_at: Date;
}
export type LoginLinkNew = Partial<LoginLinkRow> & Pick<LoginLinkRow, 'method' | 'subject' | 'user_id'>;

/** account.oauth_clients */
export interface OauthClientRow {
  client_id: string;
  space_id: string;
  client_name: string | null;
  redirect_uris: readonly string[];
  created_at: Date;
}
export type OauthClientNew = Partial<OauthClientRow> & Pick<OauthClientRow, 'client_id' | 'space_id'>;

/** account.oauth_codes */
export interface OauthCodeRow {
  code_hash: string;
  client_id: string;
  device_draft: unknown;
  code_challenge: string;
  expires_at: Date;
  used_at: Date | null;
  redirect_uri: string;
}
export type OauthCodeNew = Partial<OauthCodeRow> & Pick<OauthCodeRow, 'code_hash' | 'client_id' | 'code_challenge' | 'expires_at' | 'redirect_uri'>;

/** account.oauth_tokens */
export interface OauthTokenRow {
  id: string;
  device_id: string;
  client_id: string | null;
  kind: string;
  token_hash: string;
  scopes: readonly string[];
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}
export type OauthTokenNew = Partial<OauthTokenRow> & Pick<OauthTokenRow, 'id' | 'device_id' | 'kind' | 'token_hash' | 'expires_at'>;

/** account.secrets */
export interface SecretRow {
  space_id: string;
  key: string;
  ciphertext: Buffer;
  nonce: Buffer;
  updated_at: Date;
}
export type SecretNew = Partial<SecretRow> & Pick<SecretRow, 'space_id' | 'key' | 'ciphertext' | 'nonce'>;

/** account.settings */
export interface SettingRow {
  space_id: string;
  key: string;
  value: unknown;
  updated_at: Date;
}
export type SettingNew = Partial<SettingRow> & Pick<SettingRow, 'space_id' | 'key' | 'value'>;

/** account.space_members */
export interface SpaceMemberRow {
  space_id: string;
  user_id: string;
  role: string;
  created_at: Date;
}
export type SpaceMemberNew = Partial<SpaceMemberRow> & Pick<SpaceMemberRow, 'space_id' | 'user_id' | 'role'>;

/** account.spaces */
export interface SpaceRow {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
  version: number;
}
export type SpaceNew = Partial<SpaceRow> & Pick<SpaceRow, 'id' | 'slug' | 'name'>;

/** account.users */
export interface UserRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  created_at: Date;
  login: string;
  password_hash: string | null;
  password_changed_at: Date | null;
}
export type UserNew = Partial<UserRow> & Pick<UserRow, 'id' | 'login'>;

/** account.web_sessions */
export interface WebSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}
export type WebSessionNew = Partial<WebSessionRow> & Pick<WebSessionRow, 'id' | 'user_id' | 'token_hash' | 'expires_at'>;
