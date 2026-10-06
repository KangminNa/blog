-- migrate:up
-- app: 공간·사람·기기·인증·공통 파일·운영

-- 공간과 사람 ----------------------------------------------------------------
CREATE TABLE app.spaces (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.users (
  id              uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  github_user_id  bigint NOT NULL UNIQUE,
  github_login    text,
  display_name    text,
  avatar_url      text,
  email           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.space_members (
  space_id    uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX space_members_user_idx ON app.space_members (user_id);

CREATE TABLE app.settings (
  space_id    uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, key)
);

CREATE TABLE app.secrets (
  space_id    uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  key         text NOT NULL,
  ciphertext  bytea NOT NULL,
  nonce       bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, key)
);

-- 기기와 인증 ----------------------------------------------------------------
CREATE TABLE app.devices (
  id               uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id         uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES app.users(id) ON DELETE SET NULL,
  name             text NOT NULL,
  scopes           text[] NOT NULL DEFAULT '{}'
                   CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write']::text[]),
  is_primary_tidy  boolean NOT NULL DEFAULT false,
  meta             jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz,
  last_ip          inet,
  revoked_at       timestamptz,
  UNIQUE (space_id, name)
);
CREATE INDEX devices_active_idx ON app.devices (space_id) WHERE revoked_at IS NULL;
CREATE INDEX devices_user_idx ON app.devices (user_id);

CREATE TABLE app.oauth_clients (
  client_id      text PRIMARY KEY,
  space_id       uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  client_name    text,
  redirect_uris  text[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_clients_space_idx ON app.oauth_clients (space_id);

CREATE TABLE app.oauth_codes (
  code_hash       text PRIMARY KEY,
  client_id       text NOT NULL REFERENCES app.oauth_clients(client_id) ON DELETE CASCADE,
  device_draft    jsonb NOT NULL DEFAULT '{}',
  code_challenge  text NOT NULL,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);
CREATE INDEX oauth_codes_client_idx ON app.oauth_codes (client_id);
CREATE INDEX oauth_codes_expires_idx ON app.oauth_codes (expires_at);

CREATE TABLE app.oauth_tokens (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  device_id   uuid NOT NULL REFERENCES app.devices(id) ON DELETE CASCADE,
  client_id   text REFERENCES app.oauth_clients(client_id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('access', 'refresh')),
  token_hash  text NOT NULL UNIQUE,
  scopes      text[] NOT NULL DEFAULT '{}',
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_tokens_device_idx ON app.oauth_tokens (device_id);
CREATE INDEX oauth_tokens_client_idx ON app.oauth_tokens (client_id);
CREATE INDEX oauth_tokens_expires_idx ON app.oauth_tokens (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE app.device_tokens (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  device_id   uuid NOT NULL REFERENCES app.devices(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  prefix      text NOT NULL,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_device_idx ON app.device_tokens (device_id);

CREATE TABLE app.web_sessions (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX web_sessions_user_idx ON app.web_sessions (user_id);
CREATE INDEX web_sessions_expires_idx ON app.web_sessions (expires_at);

-- 공통 파일 (내용 주소) --------------------------------------------------------
CREATE TABLE app.blobs (
  hash             text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),   -- sha256
  mime             text NOT NULL,
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  width            int,
  height           int,
  storage_backend  text NOT NULL DEFAULT 'disk',
  storage_key      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 동시성·운영 ----------------------------------------------------------------
CREATE TABLE app.idempotency (
  device_id   uuid NOT NULL REFERENCES app.devices(id) ON DELETE CASCADE,
  request_id  text NOT NULL,
  tool        text NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, request_id)
);
CREATE INDEX idempotency_created_idx ON app.idempotency (created_at);

CREATE TABLE app.jobs (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id      uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  kind          text NOT NULL,   -- ingest_session · merge_revisions · conflict_suggest · lint · draft_post
  target_kind   text,
  target_id     uuid,            -- 느슨한 참조 (외래키 없음)
  base_version  int,
  payload       jsonb NOT NULL DEFAULT '{}',
  result        jsonb,
  status        text NOT NULL DEFAULT 'ready'
                CHECK (status IN ('ready', 'leased', 'deferred', 'done', 'failed')),
  priority      int NOT NULL DEFAULT 0,
  lease_until   timestamptz,
  leased_by     uuid REFERENCES app.devices(id) ON DELETE SET NULL,
  attempts      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz
);
CREATE INDEX jobs_ready_idx  ON app.jobs (space_id, priority DESC, created_at) WHERE status = 'ready';
CREATE INDEX jobs_lease_idx  ON app.jobs (lease_until) WHERE status = 'leased';
CREATE INDEX jobs_target_idx ON app.jobs (target_kind, target_id) WHERE status IN ('ready', 'leased', 'deferred');
CREATE INDEX jobs_leased_by_idx ON app.jobs (leased_by);

CREATE TABLE app.edit_leases (
  target_kind       text NOT NULL CHECK (target_kind IN ('session', 'post', 'topic')),
  target_id         uuid NOT NULL,
  space_id          uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  holder            text NOT NULL,
  base_revision_id  uuid,
  base_version      int,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_kind, target_id)
);
CREATE INDEX edit_leases_expires_idx ON app.edit_leases (expires_at);

CREATE TABLE app.proposals (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id       uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  kind           text NOT NULL,   -- new_topic · merge_topics · split_topic · move_session · edge_change · conflict · sensitive
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'accepted', 'rejected', 'deferred', 'superseded')),
  target_ids     uuid[] NOT NULL DEFAULT '{}',
  base_versions  jsonb NOT NULL DEFAULT '{}',
  payload        jsonb NOT NULL DEFAULT '{}',
  actor_type     text CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id       uuid,
  job_id         uuid REFERENCES app.jobs(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     uuid REFERENCES app.users(id) ON DELETE SET NULL
);
CREATE INDEX proposals_open_idx ON app.proposals (space_id, created_at DESC) WHERE status = 'open';
CREATE INDEX proposals_targets_idx ON app.proposals USING gin (target_ids);
CREATE INDEX proposals_job_idx ON app.proposals (job_id);

CREATE TABLE app.notifications (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id       uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  severity       text NOT NULL CHECK (severity IN ('immediate', 'digest', 'log')),
  group_key      text,
  title          text NOT NULL,
  body           text,
  link           text,
  data           jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz,
  push_sent_at   timestamptz,
  email_sent_at  timestamptz,
  digest_id      uuid
);
CREATE INDEX notifications_unread_idx ON app.notifications (space_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_digest_idx ON app.notifications (space_id, group_key, created_at) WHERE digest_id IS NULL;

CREATE TABLE app.push_subscriptions (
  id               uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  user_id          uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  endpoint         text NOT NULL UNIQUE,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  fail_count       int NOT NULL DEFAULT 0
);
CREATE INDEX push_subscriptions_user_idx ON app.push_subscriptions (user_id);

CREATE TABLE app.embedding_models (
  id          smallint PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  dims        int NOT NULL CHECK (dims > 0),
  provider    text NOT NULL CHECK (provider IN ('builtin', 'ollama', 'api')),
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 로그 (MVP는 분할 없이 시작. 키는 (created_at, id)로 두어 나중에 월별 분할로 옮기기 쉽게) ----
CREATE TABLE app.changes (
  created_at  timestamptz NOT NULL DEFAULT now(),
  id          bigint GENERATED ALWAYS AS IDENTITY,
  space_id    uuid NOT NULL,
  batch_id    uuid NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id    uuid,
  domain      text NOT NULL CHECK (domain IN ('app', 'vault', 'blog', 'work')),
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  op          text NOT NULL CHECK (op IN ('insert', 'update', 'delete', 'restore')),
  before      jsonb,
  after       jsonb,
  undone_by   uuid,
  PRIMARY KEY (created_at, id)
);
CREATE INDEX changes_entity_idx ON app.changes (entity, entity_id, created_at DESC);
CREATE INDEX changes_batch_idx ON app.changes (batch_id);
CREATE INDEX changes_created_brin ON app.changes USING brin (created_at);

CREATE TABLE app.mcp_reads (
  created_at    timestamptz NOT NULL DEFAULT now(),
  id            bigint GENERATED ALWAYS AS IDENTITY,
  space_id      uuid NOT NULL,
  device_id     uuid,
  tool          text NOT NULL,
  query         jsonb NOT NULL DEFAULT '{}',
  result_count  int,
  PRIMARY KEY (created_at, id)
);
CREATE INDEX mcp_reads_device_idx ON app.mcp_reads (device_id, created_at DESC);
CREATE INDEX mcp_reads_created_brin ON app.mcp_reads USING brin (created_at);

CREATE TABLE app.outbox (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id      uuid NOT NULL,
  topic         text NOT NULL,   -- session.stored · graph.changed · post.published …
  payload       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  attempts      int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_pending_idx ON app.outbox (id) WHERE processed_at IS NULL;

-- migrate:down
DROP TABLE IF EXISTS app.outbox, app.mcp_reads, app.changes, app.embedding_models,
  app.push_subscriptions, app.notifications, app.proposals, app.edit_leases, app.jobs,
  app.idempotency, app.blobs, app.web_sessions, app.device_tokens, app.oauth_tokens,
  app.oauth_codes, app.oauth_clients, app.devices, app.secrets, app.settings,
  app.space_members, app.users, app.spaces CASCADE;
