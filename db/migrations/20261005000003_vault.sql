-- migrate:up
-- vault: 세션·그래프. blog 스키마를 참조하지 않는다.

CREATE TABLE vault.node_kinds (
  name          text PRIMARY KEY,
  detail_table  text NOT NULL,
  description   text
);

CREATE TABLE vault.edge_kinds (
  name          text PRIMARY KEY,
  directed      boolean NOT NULL,   -- false면 (src < dst)로 정렬해 저장
  ai_creatable  boolean NOT NULL,
  description   text
);

-- 그래프의 점 (세션과 주제의 공통 상위) -------------------------------------------
CREATE TABLE vault.nodes (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id     uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  kind         text NOT NULL REFERENCES vault.node_kinds(name),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  purge_after  timestamptz
);
CREATE INDEX nodes_live_idx  ON vault.nodes (space_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX nodes_purge_idx ON vault.nodes (purge_after) WHERE deleted_at IS NOT NULL;

-- 세션 ------------------------------------------------------------------------
CREATE TABLE vault.sessions (
  node_id            uuid PRIMARY KEY REFERENCES vault.nodes(id) ON DELETE CASCADE,
  space_id           uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  device_id          uuid NOT NULL REFERENCES app.devices(id),
  tool               text NOT NULL,
  source_session_id  text NOT NULL,
  project            text,
  visibility         text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  head_revision_id   uuid,   -- 지금 보여줄 판 (외래키는 아래에서 DEFERRABLE로 추가)
  held_revision_id   uuid,   -- 편집 중이라 보류된 새 원본
  version            int NOT NULL DEFAULT 1,
  pinned_sections    text[] NOT NULL DEFAULT '{}',
  head_title         text,
  head_summary       text,
  head_text          text,
  revision_count     int NOT NULL DEFAULT 0,
  started_at         timestamptz,
  last_revision_at   timestamptz,
  meta               jsonb NOT NULL DEFAULT '{}',
  UNIQUE (space_id, device_id, tool, source_session_id)
);
CREATE INDEX sessions_recent_idx ON vault.sessions (space_id, last_revision_at DESC)
  INCLUDE (head_title, visibility, project);
CREATE INDEX sessions_project_idx    ON vault.sessions (space_id, project);
CREATE INDEX sessions_visibility_idx ON vault.sessions (space_id, visibility);
CREATE INDEX sessions_device_idx     ON vault.sessions (device_id);
CREATE INDEX sessions_title_bigm     ON vault.sessions USING gin (head_title gin_bigm_ops);
CREATE INDEX sessions_text_bigm      ON vault.sessions USING gin (head_text gin_bigm_ops);

-- 세션의 판 (추가만) -----------------------------------------------------------
CREATE TABLE vault.session_revisions (
  id                uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  session_id        uuid NOT NULL REFERENCES vault.sessions(node_id) ON DELETE CASCADE,
  seq               int NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('origin', 'human', 'merge')),
  parent_ids        uuid[] NOT NULL DEFAULT '{}',
  base_revision_id  uuid,
  body_md           text NOT NULL,
  sections          jsonb NOT NULL,
  sections_schema   int NOT NULL DEFAULT 1,
  section_hashes    jsonb NOT NULL,
  content_hash      text NOT NULL,
  redactions        jsonb,
  actor_type        text NOT NULL CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id          uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq),
  UNIQUE (session_id, content_hash)
);
CREATE TRIGGER session_revisions_append_only
  BEFORE UPDATE OR DELETE ON vault.session_revisions
  FOR EACH ROW EXECUTE FUNCTION app.forbid_update_delete();

ALTER TABLE vault.sessions
  ADD CONSTRAINT sessions_head_revision_fk FOREIGN KEY (head_revision_id)
    REFERENCES vault.session_revisions(id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT sessions_held_revision_fk FOREIGN KEY (held_revision_id)
    REFERENCES vault.session_revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX sessions_head_revision_idx ON vault.sessions (head_revision_id);
CREATE INDEX sessions_held_revision_idx ON vault.sessions (held_revision_id) WHERE held_revision_id IS NOT NULL;

-- 첨부 (세션 판 ↔ 파일) --------------------------------------------------------
CREATE TABLE vault.attachments (
  revision_id  uuid NOT NULL REFERENCES vault.session_revisions(id) ON DELETE CASCADE,
  blob_hash    text NOT NULL REFERENCES app.blobs(hash),
  name         text,
  caption      text,
  position     int NOT NULL DEFAULT 0,
  visibility   text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  scan_status  text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'flagged')),
  scan_flags   jsonb,
  PRIMARY KEY (revision_id, blob_hash)
);
CREATE INDEX attachments_blob_idx ON vault.attachments (blob_hash);

-- 주제 ------------------------------------------------------------------------
CREATE TABLE vault.topics (
  node_id      uuid PRIMARY KEY REFERENCES vault.nodes(id) ON DELETE CASCADE,
  space_id     uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  slug         text NOT NULL,
  color        text,
  description  text,
  origin       text NOT NULL CHECK (origin IN ('ai', 'human')),
  pinned       boolean NOT NULL DEFAULT false,
  version      int NOT NULL DEFAULT 1,
  meta         jsonb NOT NULL DEFAULT '{}',
  UNIQUE (space_id, slug)
);
CREATE INDEX topics_name_bigm ON vault.topics USING gin (name gin_bigm_ops);

-- 연결선 ----------------------------------------------------------------------
CREATE TABLE vault.edges (
  id               uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id         uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  src              uuid NOT NULL REFERENCES vault.nodes(id) ON DELETE CASCADE,
  dst              uuid NOT NULL REFERENCES vault.nodes(id) ON DELETE CASCADE,
  kind             text NOT NULL REFERENCES vault.edge_kinds(name),
  weight           real,
  origin           text NOT NULL CHECK (origin IN ('ai', 'human')),
  pinned           boolean NOT NULL DEFAULT false,
  version          int NOT NULL DEFAULT 1,
  actor_type       text CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,   -- 사람이 지운 연결은 행을 남겨 AI가 다시 만들지 못하게 함
  deleted_by_type  text CHECK (deleted_by_type IN ('user', 'device', 'ai', 'system')),
  CHECK (src <> dst),
  UNIQUE (src, dst, kind)
);
CREATE INDEX edges_out_idx  ON vault.edges (src) INCLUDE (dst, kind) WHERE deleted_at IS NULL;
CREATE INDEX edges_in_idx   ON vault.edges (dst) INCLUDE (src, kind) WHERE deleted_at IS NULL;
CREATE INDEX edges_live_idx ON vault.edges (space_id) WHERE deleted_at IS NULL;
CREATE INDEX edges_kind_idx ON vault.edges (kind);

-- 프로젝트별 기본값 --------------------------------------------------------------
CREATE TABLE vault.project_rules (
  space_id            uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  project             text NOT NULL,
  default_visibility  text NOT NULL DEFAULT 'private' CHECK (default_visibility IN ('private', 'public')),
  collect             boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, project)
);

-- 배치와 스냅샷 -----------------------------------------------------------------
CREATE TABLE vault.layouts (
  id        uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id  uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  name      text NOT NULL,
  audience  text NOT NULL CHECK (audience IN ('public', 'owner')),
  version   bigint NOT NULL DEFAULT 0,
  built_at  timestamptz,
  UNIQUE (space_id, name)
);

CREATE TABLE vault.node_layout (
  layout_id  uuid NOT NULL REFERENCES vault.layouts(id) ON DELETE CASCADE,
  node_id    uuid NOT NULL REFERENCES vault.nodes(id) ON DELETE CASCADE,
  x          real NOT NULL,
  y          real NOT NULL,
  pinned     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (layout_id, node_id)
);
CREATE INDEX node_layout_node_idx ON vault.node_layout (node_id);

CREATE TABLE vault.graph_snapshots (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id    uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  layout_id   uuid REFERENCES vault.layouts(id) ON DELETE SET NULL,
  audience    text NOT NULL CHECK (audience IN ('public', 'owner')),
  version     bigint NOT NULL,
  blob_hash   text REFERENCES app.blobs(hash),
  node_count  int NOT NULL DEFAULT 0,
  edge_count  int NOT NULL DEFAULT 0,
  built_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX graph_snapshots_latest_idx ON vault.graph_snapshots (space_id, audience, version DESC);
CREATE INDEX graph_snapshots_layout_idx ON vault.graph_snapshots (layout_id);
CREATE INDEX graph_snapshots_blob_idx ON vault.graph_snapshots (blob_hash);

-- 검색 조각과 임베딩 --------------------------------------------------------------
CREATE TABLE vault.chunks (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id     uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES vault.sessions(node_id) ON DELETE CASCADE,
  revision_id  uuid NOT NULL REFERENCES vault.session_revisions(id) ON DELETE CASCADE,
  section      text NOT NULL,
  chunk_no     int NOT NULL,
  text         text NOT NULL,
  UNIQUE (revision_id, section, chunk_no)
);
CREATE INDEX chunks_session_idx ON vault.chunks (session_id);
CREATE INDEX chunks_text_bigm   ON vault.chunks USING gin (text gin_bigm_ops);

CREATE TABLE vault.chunk_embeddings (
  chunk_id   uuid NOT NULL REFERENCES vault.chunks(id) ON DELETE CASCADE,
  model_id   smallint NOT NULL REFERENCES app.embedding_models(id),
  embedding  vector NOT NULL,   -- 차원은 모델별 부분 인덱스에서 지정
  PRIMARY KEY (chunk_id, model_id)
);
CREATE INDEX chunk_embeddings_model_idx ON vault.chunk_embeddings (model_id);

-- migrate:down
DROP TABLE IF EXISTS vault.chunk_embeddings, vault.chunks, vault.graph_snapshots, vault.node_layout,
  vault.layouts, vault.project_rules, vault.edges, vault.topics, vault.attachments,
  vault.session_revisions, vault.sessions, vault.nodes, vault.edge_kinds, vault.node_kinds CASCADE;
