-- migrate:up
-- 아무도 쓰지 않는 표 · 칸을 지운다 (2차 정리, 기획서 결정 2026-11-14). 모두 쓰는 코드가 없어 비어 있다.
-- 필요해지는 단계에서 그때의 모양으로 다시 만든다 (AGENTS.md: 미리 만들지 않는다).
--   임베딩 · 조각: 기억은 키워드 찾기(pg_bigm)로 한다. pgvector 확장과 이미지는 그대로 둔다 (이미지를 바꿀 때 함께 뺀다)
--   세션 첨부 · 그래프 스냅숏 · 읽기 기록 · 공간 비밀값 · 편집 임대 · 공감 기록
--   칸: 이메일 채널(8단계는 하지 않는다), 세션 편집 · 머리 요약, 기기의 주 정리 · 마지막 IP, 글의 언어 · 블록 · 공감 수,
--       파일 저장소 종류, 점 종류의 상세 표 이름, 변경 묶음의 그래프 판
DROP TABLE vault.chunk_embeddings, blog.chunk_embeddings;
DROP TABLE vault.chunks, blog.chunks;
DROP TABLE platform.embedding_models;
DROP TABLE vault.attachments, vault.graph_snapshots;
DROP TABLE mcp.mcp_reads;
DROP TABLE account.secrets;
DROP TABLE vault.edit_leases, blog.edit_leases;
DROP TABLE blog.stone_log;

ALTER TABLE account.devices DROP COLUMN is_primary_tidy, DROP COLUMN last_ip;
ALTER TABLE account.users DROP COLUMN email;
ALTER TABLE vault.sessions DROP COLUMN held_revision_id, DROP COLUMN head_summary;
ALTER TABLE vault.change_sets DROP COLUMN base_graph_version;
ALTER TABLE vault.node_kinds DROP COLUMN detail_table;
ALTER TABLE blog.posts DROP COLUMN lang, DROP COLUMN stone_count;
ALTER TABLE blog.post_revisions DROP COLUMN blocks;
ALTER TABLE platform.blobs DROP COLUMN storage_backend;
-- digest_id와 함께 notifications_digest_idx가 지워진다. 같은 묶음 키의 안 읽은 알림을 찾는 자리(Notices)는 새 인덱스로
ALTER TABLE platform.notifications DROP COLUMN email_sent_at, DROP COLUMN digest_id;
CREATE INDEX notifications_group_idx ON platform.notifications (space_id, group_key) WHERE read_at IS NULL;

-- migrate:down
DROP INDEX platform.notifications_group_idx;
ALTER TABLE platform.notifications ADD COLUMN email_sent_at timestamptz, ADD COLUMN digest_id uuid;
CREATE INDEX notifications_digest_idx ON platform.notifications (space_id, group_key, created_at) WHERE digest_id IS NULL;
ALTER TABLE platform.blobs ADD COLUMN storage_backend text NOT NULL DEFAULT 'disk';
ALTER TABLE blog.post_revisions ADD COLUMN blocks jsonb;
ALTER TABLE blog.posts ADD COLUMN lang text NOT NULL DEFAULT 'ko', ADD COLUMN stone_count integer NOT NULL DEFAULT 0;
ALTER TABLE vault.node_kinds ADD COLUMN detail_table text;
UPDATE vault.node_kinds SET detail_table = 'vault.' || CASE name WHEN 'category' THEN 'categories' ELSE name || 's' END;
ALTER TABLE vault.node_kinds ALTER COLUMN detail_table SET NOT NULL;
ALTER TABLE vault.change_sets ADD COLUMN base_graph_version bigint;
ALTER TABLE vault.sessions ADD COLUMN held_revision_id uuid, ADD COLUMN head_summary text;
ALTER TABLE vault.sessions ADD CONSTRAINT sessions_held_revision_fk FOREIGN KEY (held_revision_id)
  REFERENCES vault.session_revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX sessions_held_revision_idx ON vault.sessions (held_revision_id) WHERE held_revision_id IS NOT NULL;
ALTER TABLE account.users ADD COLUMN email text;
ALTER TABLE account.devices ADD COLUMN is_primary_tidy boolean NOT NULL DEFAULT false, ADD COLUMN last_ip inet;

CREATE TABLE account.secrets (
    space_id uuid NOT NULL,
    key text NOT NULL,
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE blog.chunk_embeddings (
    chunk_id uuid NOT NULL,
    model_id smallint NOT NULL,
    embedding public.vector NOT NULL
);
CREATE TABLE blog.chunks (
    id uuid DEFAULT platform.uuid_v7() NOT NULL,
    space_id uuid NOT NULL,
    post_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    chunk_no integer NOT NULL,
    text text NOT NULL
);
CREATE TABLE blog.edit_leases (
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    space_id uuid NOT NULL,
    holder text NOT NULL,
    base_revision_id uuid,
    base_version integer,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT edit_leases_target_kind_check CHECK ((target_kind = 'post'::text))
);
CREATE TABLE blog.stone_log (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    post_id uuid NOT NULL,
    visitor_hash text NOT NULL
);
CREATE TABLE mcp.mcp_reads (
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    device_id uuid,
    tool text NOT NULL,
    query jsonb DEFAULT '{}'::jsonb NOT NULL,
    result_count integer
);
ALTER TABLE mcp.mcp_reads ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME mcp.mcp_reads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE platform.embedding_models (
    id smallint NOT NULL,
    name text NOT NULL,
    dims integer NOT NULL,
    provider text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT embedding_models_dims_check CHECK ((dims > 0)),
    CONSTRAINT embedding_models_provider_check CHECK ((provider = ANY (ARRAY['builtin'::text, 'ollama'::text, 'api'::text])))
);
CREATE TABLE vault.attachments (
    revision_id uuid NOT NULL,
    blob_hash text NOT NULL,
    name text,
    caption text,
    "position" integer DEFAULT 0 NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    scan_status text DEFAULT 'pending'::text NOT NULL,
    scan_flags jsonb,
    CONSTRAINT attachments_scan_status_check CHECK ((scan_status = ANY (ARRAY['pending'::text, 'clean'::text, 'flagged'::text]))),
    CONSTRAINT attachments_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'public'::text])))
);
CREATE TABLE vault.chunk_embeddings (
    chunk_id uuid NOT NULL,
    model_id smallint NOT NULL,
    embedding public.vector NOT NULL
);
CREATE TABLE vault.chunks (
    id uuid DEFAULT platform.uuid_v7() NOT NULL,
    space_id uuid NOT NULL,
    session_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    section text NOT NULL,
    chunk_no integer NOT NULL,
    text text NOT NULL
);
CREATE TABLE vault.edit_leases (
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    space_id uuid NOT NULL,
    holder text NOT NULL,
    base_revision_id uuid,
    base_version integer,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT edit_leases_target_kind_check CHECK ((target_kind = ANY (ARRAY['session'::text, 'topic'::text])))
);
CREATE TABLE vault.graph_snapshots (
    id bigint NOT NULL,
    space_id uuid NOT NULL,
    view_id uuid,
    audience text NOT NULL,
    version bigint NOT NULL,
    blob_hash text,
    node_count integer DEFAULT 0 NOT NULL,
    edge_count integer DEFAULT 0 NOT NULL,
    built_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT graph_snapshots_audience_check CHECK ((audience = ANY (ARRAY['public'::text, 'owner'::text])))
);
ALTER TABLE vault.graph_snapshots ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME vault.graph_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
ALTER TABLE ONLY account.secrets
    ADD CONSTRAINT secrets_pkey PRIMARY KEY (space_id, key);
ALTER TABLE ONLY blog.chunk_embeddings
    ADD CONSTRAINT chunk_embeddings_pkey PRIMARY KEY (chunk_id, model_id);
ALTER TABLE ONLY blog.chunks
    ADD CONSTRAINT chunks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY blog.chunks
    ADD CONSTRAINT chunks_revision_id_chunk_no_key UNIQUE (revision_id, chunk_no);
ALTER TABLE ONLY blog.edit_leases
    ADD CONSTRAINT edit_leases_pkey PRIMARY KEY (target_kind, target_id);
ALTER TABLE ONLY blog.stone_log
    ADD CONSTRAINT stone_log_pkey PRIMARY KEY (created_at, post_id, visitor_hash);
ALTER TABLE ONLY mcp.mcp_reads
    ADD CONSTRAINT mcp_reads_pkey PRIMARY KEY (created_at, id);
ALTER TABLE ONLY platform.embedding_models
    ADD CONSTRAINT embedding_models_name_key UNIQUE (name);
ALTER TABLE ONLY platform.embedding_models
    ADD CONSTRAINT embedding_models_pkey PRIMARY KEY (id);
ALTER TABLE ONLY vault.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (revision_id, blob_hash);
ALTER TABLE ONLY vault.chunk_embeddings
    ADD CONSTRAINT chunk_embeddings_pkey PRIMARY KEY (chunk_id, model_id);
ALTER TABLE ONLY vault.chunks
    ADD CONSTRAINT chunks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY vault.chunks
    ADD CONSTRAINT chunks_revision_id_section_chunk_no_key UNIQUE (revision_id, section, chunk_no);
ALTER TABLE ONLY vault.edit_leases
    ADD CONSTRAINT edit_leases_pkey PRIMARY KEY (target_kind, target_id);
ALTER TABLE ONLY vault.graph_snapshots
    ADD CONSTRAINT graph_snapshots_pkey PRIMARY KEY (id);
CREATE INDEX blog_chunk_embeddings_m1_hnsw ON blog.chunk_embeddings USING hnsw (((embedding)::public.vector(384)) public.vector_cosine_ops) WHERE (model_id = 1);
CREATE INDEX blog_chunk_embeddings_model_idx ON blog.chunk_embeddings USING btree (model_id);
CREATE INDEX blog_chunks_post_idx ON blog.chunks USING btree (post_id);
CREATE INDEX blog_chunks_text_bigm ON blog.chunks USING gin (text public.gin_bigm_ops);
CREATE INDEX edit_leases_expires_idx ON blog.edit_leases USING btree (expires_at);
CREATE INDEX stone_log_created_brin ON blog.stone_log USING brin (created_at);
CREATE INDEX stone_log_post_visitor_idx ON blog.stone_log USING btree (post_id, visitor_hash);
CREATE INDEX mcp_reads_created_brin ON mcp.mcp_reads USING brin (created_at);
CREATE INDEX mcp_reads_device_idx ON mcp.mcp_reads USING btree (device_id, created_at DESC);
CREATE INDEX attachments_blob_idx ON vault.attachments USING btree (blob_hash);
CREATE INDEX chunk_embeddings_m1_hnsw ON vault.chunk_embeddings USING hnsw (((embedding)::public.vector(384)) public.vector_cosine_ops) WHERE (model_id = 1);
CREATE INDEX chunk_embeddings_model_idx ON vault.chunk_embeddings USING btree (model_id);
CREATE INDEX chunks_session_idx ON vault.chunks USING btree (session_id);
CREATE INDEX chunks_text_bigm ON vault.chunks USING gin (text public.gin_bigm_ops);
CREATE INDEX edit_leases_expires_idx ON vault.edit_leases USING btree (expires_at);
CREATE INDEX graph_snapshots_blob_idx ON vault.graph_snapshots USING btree (blob_hash);
CREATE INDEX graph_snapshots_latest_idx ON vault.graph_snapshots USING btree (space_id, audience, version DESC);
CREATE INDEX graph_snapshots_view_idx ON vault.graph_snapshots USING btree (view_id);
ALTER TABLE ONLY account.secrets
    ADD CONSTRAINT secrets_space_id_fkey FOREIGN KEY (space_id) REFERENCES account.spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY blog.chunk_embeddings
    ADD CONSTRAINT chunk_embeddings_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES blog.chunks(id) ON DELETE CASCADE;
ALTER TABLE ONLY blog.chunks
    ADD CONSTRAINT chunks_post_id_fkey FOREIGN KEY (post_id) REFERENCES blog.posts(id) ON DELETE CASCADE;
ALTER TABLE ONLY blog.chunks
    ADD CONSTRAINT chunks_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES blog.post_revisions(id) ON DELETE CASCADE;
ALTER TABLE ONLY blog.stone_log
    ADD CONSTRAINT stone_log_post_id_fkey FOREIGN KEY (post_id) REFERENCES blog.posts(id) ON DELETE CASCADE;
ALTER TABLE ONLY vault.attachments
    ADD CONSTRAINT attachments_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES vault.session_revisions(id) ON DELETE CASCADE;
ALTER TABLE ONLY vault.chunk_embeddings
    ADD CONSTRAINT chunk_embeddings_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES vault.chunks(id) ON DELETE CASCADE;
ALTER TABLE ONLY vault.chunks
    ADD CONSTRAINT chunks_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES vault.session_revisions(id) ON DELETE CASCADE;
ALTER TABLE ONLY vault.chunks
    ADD CONSTRAINT chunks_session_id_fkey FOREIGN KEY (session_id) REFERENCES vault.sessions(node_id) ON DELETE CASCADE;
ALTER TABLE ONLY vault.graph_snapshots
    ADD CONSTRAINT graph_snapshots_view_id_fkey FOREIGN KEY (view_id) REFERENCES vault.graph_views(id) ON DELETE SET NULL;
