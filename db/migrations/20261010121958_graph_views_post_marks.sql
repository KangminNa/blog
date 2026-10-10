-- migrate:up
-- 그래프 보기 설정과 글 자리 사본, 참고 세션 기록 정리 (2026-10-10 결정)
--   1. vault.layouts → vault.graph_views: 점 좌표만이 아니라 보기 설정(색 기준, 보일 점 종류 등)까지 저장한다.
--      방문자 기본값 · 주인 기본값은 is_default, 나머지는 주인이 저장한 보기
--   2. vault.post_marks: blog가 보낸 글 이벤트로 채우는 사본. vault는 blog를 읽지 않고 이것으로 글 점을 그린다
--   3. blog.post_sources 삭제: 글의 출처는 참고 wiki(post_wiki_refs)로 남기고, 세션은 wiki를 거쳐 안다

-- 1. 그래프 보기 ------------------------------------------------------------------
ALTER TABLE vault.layouts RENAME TO graph_views;
ALTER TABLE vault.graph_views RENAME CONSTRAINT layouts_pkey TO graph_views_pkey;
ALTER TABLE vault.graph_views RENAME CONSTRAINT layouts_space_id_name_key TO graph_views_space_id_name_key;
ALTER TABLE vault.graph_views RENAME CONSTRAINT layouts_audience_check TO graph_views_audience_check;
ALTER TABLE vault.graph_views
  ADD COLUMN settings   jsonb NOT NULL DEFAULT '{}',          -- 색 기준, 보일 점·선 종류, 거리 등. 서버의 GraphView 객체가 읽는다
  ADD COLUMN is_default boolean NOT NULL DEFAULT false,       -- 그 대상(public · owner)이 처음 보는 보기
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN vault.graph_views.audience IS 'public: 방문자에게 보일 수 있는 보기, owner: 주인만';
-- 대상마다 기본 보기는 하나
CREATE UNIQUE INDEX graph_views_default ON vault.graph_views (space_id, audience) WHERE is_default;

ALTER TABLE vault.node_layout RENAME COLUMN layout_id TO view_id;
ALTER TABLE vault.node_layout RENAME CONSTRAINT node_layout_layout_id_fkey TO node_layout_view_id_fkey;
ALTER TABLE vault.graph_snapshots RENAME COLUMN layout_id TO view_id;
ALTER TABLE vault.graph_snapshots RENAME CONSTRAINT graph_snapshots_layout_id_fkey TO graph_snapshots_view_id_fkey;
ALTER INDEX vault.graph_snapshots_layout_idx RENAME TO graph_snapshots_view_idx;

-- 2. 글 자리 사본 ------------------------------------------------------------------
-- blog의 글 이벤트(발행 · 수정 · 내림 · 삭제)를 vault의 Handler가 받아 채운다. post_id는 blog 값이라 외래키 없음.
-- 이벤트가 늦게 오거나 순서가 바뀌어도 post_version이 더 큰 것만 반영한다.
CREATE TABLE vault.post_marks (
  post_id       uuid PRIMARY KEY,                             -- blog.posts.id (외래키 없음)
  space_id      uuid NOT NULL,
  title         text NOT NULL,
  slug          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft', 'published')),
  main_wiki_id  uuid REFERENCES vault.wikis(node_id) ON DELETE SET NULL,  -- 비어 있으면 그래프에 안 나옴
  ref_wiki_ids  uuid[] NOT NULL DEFAULT '{}',                -- 대표 말고 참고한 wiki (참고 선)
  post_version  int NOT NULL,                                -- blog 쪽 글 version. 더 큰 것만 반영
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_marks_by_wiki ON vault.post_marks (space_id, main_wiki_id);
CREATE INDEX post_marks_refs    ON vault.post_marks USING gin (ref_wiki_ids);   -- wiki를 참고한 글

-- 3. 참고 세션 기록 삭제 -------------------------------------------------------------
DROP TABLE blog.post_sources;

-- migrate:down
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

DROP TABLE vault.post_marks;

ALTER INDEX vault.graph_snapshots_view_idx RENAME TO graph_snapshots_layout_idx;
ALTER TABLE vault.graph_snapshots RENAME CONSTRAINT graph_snapshots_view_id_fkey TO graph_snapshots_layout_id_fkey;
ALTER TABLE vault.graph_snapshots RENAME COLUMN view_id TO layout_id;
ALTER TABLE vault.node_layout RENAME CONSTRAINT node_layout_view_id_fkey TO node_layout_layout_id_fkey;
ALTER TABLE vault.node_layout RENAME COLUMN view_id TO layout_id;

DROP INDEX vault.graph_views_default;
COMMENT ON COLUMN vault.graph_views.audience IS NULL;
ALTER TABLE vault.graph_views DROP COLUMN updated_at, DROP COLUMN is_default, DROP COLUMN settings;
ALTER TABLE vault.graph_views RENAME CONSTRAINT graph_views_audience_check TO layouts_audience_check;
ALTER TABLE vault.graph_views RENAME CONSTRAINT graph_views_space_id_name_key TO layouts_space_id_name_key;
ALTER TABLE vault.graph_views RENAME CONSTRAINT graph_views_pkey TO layouts_pkey;
ALTER TABLE vault.graph_views RENAME TO layouts;
