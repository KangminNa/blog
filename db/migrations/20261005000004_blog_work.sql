-- migrate:up
-- blog: 글. vault 스키마를 외래키로 참조하지 않는다.
-- work: 글감 상자. 세션·글은 느슨한 참조(외래키 없음)로만 가리킨다.

CREATE TABLE blog.categories (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id    uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES blog.categories(id) ON DELETE RESTRICT,
  name        text NOT NULL,
  slug        text NOT NULL,
  sort        int NOT NULL DEFAULT 0,
  version     int NOT NULL DEFAULT 1,
  deleted_at  timestamptz,
  UNIQUE NULLS NOT DISTINCT (space_id, parent_id, slug)
);
CREATE INDEX categories_tree_idx ON blog.categories (space_id, parent_id, sort);
CREATE INDEX categories_parent_idx ON blog.categories (parent_id);

CREATE TABLE blog.series (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id     uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  slug         text NOT NULL,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, slug)
);

CREATE TABLE blog.posts (
  id                uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id          uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  slug              text NOT NULL,
  lang              text NOT NULL DEFAULT 'ko',
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  title             text,
  excerpt           text,
  head_text         text,
  head_revision_id  uuid,   -- 외래키는 아래에서 DEFERRABLE로 추가
  version           int NOT NULL DEFAULT 1,
  category_id       uuid REFERENCES blog.categories(id) ON DELETE SET NULL,
  series_id         uuid REFERENCES blog.series(id) ON DELETE SET NULL,
  series_order      int,
  tags              text[] NOT NULL DEFAULT '{}',
  cover_blob_hash   text REFERENCES app.blobs(hash),
  align             text NOT NULL DEFAULT 'left' CHECK (align IN ('left', 'center')),
  stone_count       int NOT NULL DEFAULT 0,
  published_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  purge_after       timestamptz,
  meta              jsonb NOT NULL DEFAULT '{}',
  UNIQUE (space_id, slug)
);
CREATE INDEX posts_public_list_idx ON blog.posts (space_id, published_at DESC)
  INCLUDE (title, excerpt, category_id, cover_blob_hash)
  WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX posts_admin_list_idx ON blog.posts (space_id, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_category_idx   ON blog.posts (category_id) WHERE deleted_at IS NULL;
CREATE INDEX posts_series_idx     ON blog.posts (series_id, series_order);
CREATE INDEX posts_tags_idx       ON blog.posts USING gin (tags);
CREATE INDEX posts_title_bigm     ON blog.posts USING gin (title gin_bigm_ops);
CREATE INDEX posts_text_bigm      ON blog.posts USING gin (head_text gin_bigm_ops);
CREATE INDEX posts_purge_idx      ON blog.posts (purge_after) WHERE deleted_at IS NOT NULL;
CREATE INDEX posts_cover_idx      ON blog.posts (cover_blob_hash);

CREATE TABLE blog.post_revisions (
  id                uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  post_id           uuid NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,
  seq               int NOT NULL,
  body_md           text NOT NULL,
  blocks            jsonb,
  base_revision_id  uuid,
  request_id        text,
  actor_type        text NOT NULL CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id          uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, seq),
  UNIQUE (post_id, request_id)
);
CREATE TRIGGER post_revisions_append_only
  BEFORE UPDATE OR DELETE ON blog.post_revisions
  FOR EACH ROW EXECUTE FUNCTION app.forbid_update_delete();

ALTER TABLE blog.posts
  ADD CONSTRAINT posts_head_revision_fk FOREIGN KEY (head_revision_id)
    REFERENCES blog.post_revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX posts_head_revision_idx ON blog.posts (head_revision_id);

CREATE TABLE blog.assets (
  post_id    uuid NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,
  blob_hash  text NOT NULL REFERENCES app.blobs(hash),
  alt        text,
  caption    text,
  PRIMARY KEY (post_id, blob_hash)
);
CREATE INDEX assets_blob_idx ON blog.assets (blob_hash);

-- 글의 참고 세션 (관리자만 보는 메타 정보, vault와 외래키 없음)
CREATE TABLE blog.post_sources (
  post_id        uuid NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,
  session_id     uuid NOT NULL,
  session_title  text,
  project        text,
  tool           text,
  device_name    text,
  session_date   timestamptz,
  revision_seq   int,
  via            text NOT NULL CHECK (via IN ('cairn-write', 'basket', 'material_panel', 'manual')),
  added_at       timestamptz NOT NULL DEFAULT now(),
  actor_type     text NOT NULL CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id       uuid,
  PRIMARY KEY (post_id, session_id)
);
CREATE INDEX post_sources_session_idx ON blog.post_sources (session_id);

CREATE TABLE blog.chunks (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id     uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  post_id      uuid NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,
  revision_id  uuid NOT NULL REFERENCES blog.post_revisions(id) ON DELETE CASCADE,
  chunk_no     int NOT NULL,
  text         text NOT NULL,
  UNIQUE (revision_id, chunk_no)
);
CREATE INDEX blog_chunks_post_idx ON blog.chunks (post_id);
CREATE INDEX blog_chunks_text_bigm ON blog.chunks USING gin (text gin_bigm_ops);

CREATE TABLE blog.chunk_embeddings (
  chunk_id   uuid NOT NULL REFERENCES blog.chunks(id) ON DELETE CASCADE,
  model_id   smallint NOT NULL REFERENCES app.embedding_models(id),
  embedding  vector NOT NULL,
  PRIMARY KEY (chunk_id, model_id)
);
CREATE INDEX blog_chunk_embeddings_model_idx ON blog.chunk_embeddings (model_id);

-- 공감 중복 방지 로그 (MVP는 분할 없이)
CREATE TABLE blog.stone_log (
  created_at    timestamptz NOT NULL DEFAULT now(),
  post_id       uuid NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,
  visitor_hash  text NOT NULL,
  PRIMARY KEY (created_at, post_id, visitor_hash)
);
CREATE INDEX stone_log_post_visitor_idx ON blog.stone_log (post_id, visitor_hash);
CREATE INDEX stone_log_created_brin ON blog.stone_log USING brin (created_at);

-- 글감 상자 -------------------------------------------------------------------
CREATE TABLE work.baskets (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  space_id     uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT '글감 상자',
  created_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
CREATE INDEX baskets_space_idx ON work.baskets (space_id) WHERE archived_at IS NULL;

CREATE TABLE work.basket_items (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  basket_id   uuid NOT NULL REFERENCES work.baskets(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('session', 'post', 'photo', 'file', 'link', 'note')),
  ref_id      uuid,                                    -- session·post. 외래키 없음
  blob_hash   text REFERENCES app.blobs(hash),         -- photo·file
  url         text,
  title       text,
  note        text,
  sort        int NOT NULL DEFAULT 0,
  actor_type  text NOT NULL CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind IN ('session', 'post') AND ref_id IS NOT NULL) OR
    (kind IN ('photo', 'file') AND blob_hash IS NOT NULL) OR
    (kind = 'link' AND url IS NOT NULL) OR
    (kind = 'note' AND note IS NOT NULL)
  )
);
CREATE INDEX basket_items_order_idx ON work.basket_items (basket_id, sort);
CREATE INDEX basket_items_blob_idx  ON work.basket_items (blob_hash);

-- migrate:down
DROP TABLE IF EXISTS work.basket_items, work.baskets CASCADE;
DROP TABLE IF EXISTS blog.stone_log, blog.chunk_embeddings, blog.chunks, blog.post_sources,
  blog.assets, blog.post_revisions, blog.posts, blog.series, blog.categories CASCADE;
