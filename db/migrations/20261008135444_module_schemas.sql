-- migrate:up
-- 모듈 = 스키마. 테이블을 주인 모듈의 스키마로 옮기고, 모듈 사이 외래키를 없앤다.
-- 모듈: platform(공통 기반) · account · vault · blog(blog·work 스키마) · mcp
-- 외래키를 지운 열은 그대로 두고, 값의 유효성은 주인 모듈의 코드가 지킨다 (docs/객체설계.md 모듈 규칙).

CREATE SCHEMA account;   -- 공간·사람·기기·로그인
CREATE SCHEMA platform;  -- 공통 기반: 파일·중복 방지·outbox·일거리·알림·임베딩 모델
CREATE SCHEMA mcp;       -- AI 도구 입구: 읽기 기록

-- 공통 함수는 platform으로 (테이블 기본값·트리거는 함수를 OID로 가리켜 그대로 동작)
ALTER FUNCTION app.uuid_v7() SET SCHEMA platform;
ALTER FUNCTION app.forbid_update_delete() SET SCHEMA platform;

-- account
ALTER TABLE app.spaces SET SCHEMA account;
ALTER TABLE app.users SET SCHEMA account;
ALTER TABLE app.space_members SET SCHEMA account;
ALTER TABLE app.settings SET SCHEMA account;
ALTER TABLE app.secrets SET SCHEMA account;
ALTER TABLE app.devices SET SCHEMA account;
ALTER TABLE app.oauth_clients SET SCHEMA account;
ALTER TABLE app.oauth_codes SET SCHEMA account;
ALTER TABLE app.oauth_tokens SET SCHEMA account;
ALTER TABLE app.device_tokens SET SCHEMA account;
ALTER TABLE app.web_sessions SET SCHEMA account;

-- platform
ALTER TABLE app.blobs SET SCHEMA platform;
ALTER TABLE app.idempotency SET SCHEMA platform;
ALTER TABLE app.jobs SET SCHEMA platform;
ALTER TABLE app.notifications SET SCHEMA platform;
ALTER TABLE app.push_subscriptions SET SCHEMA platform;
ALTER TABLE app.embedding_models SET SCHEMA platform;
ALTER TABLE app.outbox SET SCHEMA platform;

-- vault
ALTER TABLE app.proposals SET SCHEMA vault;
ALTER TABLE app.changes SET SCHEMA vault;
ALTER TABLE app.edit_leases SET SCHEMA vault;

-- mcp
ALTER TABLE app.mcp_reads SET SCHEMA mcp;

DROP SCHEMA app;

-- 모듈 사이 외래키 30개
ALTER TABLE vault.edit_leases DROP CONSTRAINT edit_leases_space_id_fkey;   -- → account.spaces
ALTER TABLE platform.idempotency DROP CONSTRAINT idempotency_device_id_fkey;   -- → account.devices
ALTER TABLE platform.jobs DROP CONSTRAINT jobs_leased_by_fkey;   -- → account.devices
ALTER TABLE platform.jobs DROP CONSTRAINT jobs_space_id_fkey;   -- → account.spaces
ALTER TABLE platform.notifications DROP CONSTRAINT notifications_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.proposals DROP CONSTRAINT proposals_decided_by_fkey;   -- → account.users
ALTER TABLE vault.proposals DROP CONSTRAINT proposals_job_id_fkey;   -- → platform.jobs
ALTER TABLE vault.proposals DROP CONSTRAINT proposals_space_id_fkey;   -- → account.spaces
ALTER TABLE platform.push_subscriptions DROP CONSTRAINT push_subscriptions_user_id_fkey;   -- → account.users
ALTER TABLE blog.assets DROP CONSTRAINT assets_blob_hash_fkey;   -- → platform.blobs
ALTER TABLE blog.categories DROP CONSTRAINT categories_space_id_fkey;   -- → account.spaces
ALTER TABLE blog.chunk_embeddings DROP CONSTRAINT chunk_embeddings_model_id_fkey;   -- → platform.embedding_models
ALTER TABLE blog.chunks DROP CONSTRAINT chunks_space_id_fkey;   -- → account.spaces
ALTER TABLE blog.posts DROP CONSTRAINT posts_cover_blob_hash_fkey;   -- → platform.blobs
ALTER TABLE blog.posts DROP CONSTRAINT posts_space_id_fkey;   -- → account.spaces
ALTER TABLE blog.series DROP CONSTRAINT series_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.attachments DROP CONSTRAINT attachments_blob_hash_fkey;   -- → platform.blobs
ALTER TABLE vault.chunk_embeddings DROP CONSTRAINT chunk_embeddings_model_id_fkey;   -- → platform.embedding_models
ALTER TABLE vault.chunks DROP CONSTRAINT chunks_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.edges DROP CONSTRAINT edges_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.graph_snapshots DROP CONSTRAINT graph_snapshots_blob_hash_fkey;   -- → platform.blobs
ALTER TABLE vault.graph_snapshots DROP CONSTRAINT graph_snapshots_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.layouts DROP CONSTRAINT layouts_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.nodes DROP CONSTRAINT nodes_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.project_rules DROP CONSTRAINT project_rules_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.sessions DROP CONSTRAINT sessions_device_id_fkey;   -- → account.devices
ALTER TABLE vault.sessions DROP CONSTRAINT sessions_space_id_fkey;   -- → account.spaces
ALTER TABLE vault.topics DROP CONSTRAINT topics_space_id_fkey;   -- → account.spaces
ALTER TABLE work.basket_items DROP CONSTRAINT basket_items_blob_hash_fkey;   -- → platform.blobs
ALTER TABLE work.baskets DROP CONSTRAINT baskets_space_id_fkey;   -- → account.spaces

-- 편집 임대는 모듈마다 따로 (세션·주제는 vault, 글은 blog)
ALTER TABLE vault.edit_leases DROP CONSTRAINT edit_leases_target_kind_check;
ALTER TABLE vault.edit_leases ADD CONSTRAINT edit_leases_target_kind_check CHECK (target_kind IN ('session', 'topic'));
CREATE TABLE blog.edit_leases (
  target_kind       text NOT NULL CHECK (target_kind IN ('post')),
  target_id         uuid NOT NULL,
  space_id          uuid NOT NULL,
  holder            text NOT NULL,
  base_revision_id  uuid,
  base_version      int,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_kind, target_id)
);
CREATE INDEX edit_leases_expires_idx ON blog.edit_leases (expires_at);

-- migrate:down
DROP TABLE blog.edit_leases;
ALTER TABLE vault.edit_leases DROP CONSTRAINT edit_leases_target_kind_check;
ALTER TABLE vault.edit_leases ADD CONSTRAINT edit_leases_target_kind_check CHECK (target_kind IN ('session', 'post', 'topic'));

ALTER TABLE vault.edit_leases ADD CONSTRAINT edit_leases_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE platform.idempotency ADD CONSTRAINT idempotency_device_id_fkey FOREIGN KEY (device_id) REFERENCES account.devices(id) ON DELETE CASCADE;
ALTER TABLE platform.jobs ADD CONSTRAINT jobs_leased_by_fkey FOREIGN KEY (leased_by) REFERENCES account.devices(id) ON DELETE SET NULL;
ALTER TABLE platform.jobs ADD CONSTRAINT jobs_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE platform.notifications ADD CONSTRAINT notifications_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.proposals ADD CONSTRAINT proposals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES account.users(id) ON DELETE SET NULL;
ALTER TABLE vault.proposals ADD CONSTRAINT proposals_job_id_fkey FOREIGN KEY (job_id) REFERENCES platform.jobs(id) ON DELETE SET NULL;
ALTER TABLE vault.proposals ADD CONSTRAINT proposals_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE platform.push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES account.users(id) ON DELETE CASCADE;
ALTER TABLE blog.assets ADD CONSTRAINT assets_blob_hash_fkey FOREIGN KEY (blob_hash) REFERENCES platform.blobs(hash);
ALTER TABLE blog.categories ADD CONSTRAINT categories_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE blog.chunk_embeddings ADD CONSTRAINT chunk_embeddings_model_id_fkey FOREIGN KEY (model_id) REFERENCES platform.embedding_models(id);
ALTER TABLE blog.chunks ADD CONSTRAINT chunks_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE blog.posts ADD CONSTRAINT posts_cover_blob_hash_fkey FOREIGN KEY (cover_blob_hash) REFERENCES platform.blobs(hash);
ALTER TABLE blog.posts ADD CONSTRAINT posts_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE blog.series ADD CONSTRAINT series_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.attachments ADD CONSTRAINT attachments_blob_hash_fkey FOREIGN KEY (blob_hash) REFERENCES platform.blobs(hash);
ALTER TABLE vault.chunk_embeddings ADD CONSTRAINT chunk_embeddings_model_id_fkey FOREIGN KEY (model_id) REFERENCES platform.embedding_models(id);
ALTER TABLE vault.chunks ADD CONSTRAINT chunks_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.edges ADD CONSTRAINT edges_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.graph_snapshots ADD CONSTRAINT graph_snapshots_blob_hash_fkey FOREIGN KEY (blob_hash) REFERENCES platform.blobs(hash);
ALTER TABLE vault.graph_snapshots ADD CONSTRAINT graph_snapshots_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.layouts ADD CONSTRAINT layouts_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.nodes ADD CONSTRAINT nodes_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.project_rules ADD CONSTRAINT project_rules_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.sessions ADD CONSTRAINT sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES account.devices(id);
ALTER TABLE vault.sessions ADD CONSTRAINT sessions_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE vault.topics ADD CONSTRAINT topics_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE work.basket_items ADD CONSTRAINT basket_items_blob_hash_fkey FOREIGN KEY (blob_hash) REFERENCES platform.blobs(hash);
ALTER TABLE work.baskets ADD CONSTRAINT baskets_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;

CREATE SCHEMA app;
ALTER TABLE account.spaces SET SCHEMA app;
ALTER TABLE account.users SET SCHEMA app;
ALTER TABLE account.space_members SET SCHEMA app;
ALTER TABLE account.settings SET SCHEMA app;
ALTER TABLE account.secrets SET SCHEMA app;
ALTER TABLE account.devices SET SCHEMA app;
ALTER TABLE account.oauth_clients SET SCHEMA app;
ALTER TABLE account.oauth_codes SET SCHEMA app;
ALTER TABLE account.oauth_tokens SET SCHEMA app;
ALTER TABLE account.device_tokens SET SCHEMA app;
ALTER TABLE account.web_sessions SET SCHEMA app;
ALTER TABLE platform.blobs SET SCHEMA app;
ALTER TABLE platform.idempotency SET SCHEMA app;
ALTER TABLE platform.jobs SET SCHEMA app;
ALTER TABLE platform.notifications SET SCHEMA app;
ALTER TABLE platform.push_subscriptions SET SCHEMA app;
ALTER TABLE platform.embedding_models SET SCHEMA app;
ALTER TABLE platform.outbox SET SCHEMA app;
ALTER TABLE vault.proposals SET SCHEMA app;
ALTER TABLE vault.changes SET SCHEMA app;
ALTER TABLE vault.edit_leases SET SCHEMA app;
ALTER TABLE mcp.mcp_reads SET SCHEMA app;
ALTER FUNCTION platform.uuid_v7() SET SCHEMA app;
ALTER FUNCTION platform.forbid_update_delete() SET SCHEMA app;
DROP SCHEMA mcp;
DROP SCHEMA platform;
DROP SCHEMA account;
