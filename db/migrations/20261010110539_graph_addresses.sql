-- migrate:up
-- 그래프 = 대표 하나 + 선 (MVP 기획서 7.5, 2026-10-10 확정)
--   점 네 종류: 카테고리 · wiki · 세션 · 글
--   대표(주소)는 열로 둔다: 세션.wiki_id, wiki.category_id, 글.main_wiki_id
--   대표가 비어 있으면: 세션은 도착 구역, wiki는 미분류, 글은 그래프에 나오지 않음
--   대표 밖 연결(재료 · wiki 링크 · 비슷함)만 vault.edges에 선으로 둔다
--   위를 지워도 아래는 지워지지 않는다 (RESTRICT · SET NULL)

-- 점 종류: topic → category, wiki 추가 ------------------------------------------
INSERT INTO vault.node_kinds (name, detail_table, description) VALUES
  ('category', 'vault.categories', '지도의 구역. 사람이 만들고 AI는 제안만 한다'),
  ('wiki',     'vault.wikis',      '여러 세션을 모아 쓴 정리 문서');
UPDATE vault.nodes SET kind = 'category' WHERE kind = 'topic';
DELETE FROM vault.node_kinds WHERE name = 'topic';

-- 카테고리 (주제를 바꾼 것) --------------------------------------------------------
ALTER TABLE vault.topics RENAME TO categories;
ALTER TABLE vault.categories RENAME CONSTRAINT topics_pkey TO categories_pkey;
ALTER TABLE vault.categories RENAME CONSTRAINT topics_space_id_slug_key TO categories_space_id_slug_key;
ALTER TABLE vault.categories RENAME CONSTRAINT topics_origin_check TO categories_origin_check;
ALTER TABLE vault.categories RENAME CONSTRAINT topics_node_id_fkey TO categories_node_id_fkey;
ALTER INDEX vault.topics_name_bigm RENAME TO categories_name_bigm;
ALTER TABLE vault.categories ADD COLUMN sort int NOT NULL DEFAULT 0;
COMMENT ON COLUMN vault.categories.description IS '분류 기준. AI 정리 스킬이 읽고 새 wiki를 어디에 둘지 제안한다';
CREATE INDEX categories_sort_idx ON vault.categories (space_id, sort);

-- wiki ------------------------------------------------------------------------
-- 본문(판) 저장 방식은 정한 뒤 다음 마이그레이션에서 더한다.
CREATE TABLE vault.wikis (
  node_id      uuid PRIMARY KEY REFERENCES vault.nodes(id) ON DELETE CASCADE,
  space_id     uuid NOT NULL,
  category_id  uuid REFERENCES vault.categories(node_id) ON DELETE RESTRICT,  -- 대표. 비어 있으면 미분류
  title        text NOT NULL,
  slug         text NOT NULL,
  visibility   text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  origin       text NOT NULL CHECK (origin IN ('ai', 'human')),
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  meta         jsonb NOT NULL DEFAULT '{}',
  UNIQUE (space_id, slug)
);
CREATE INDEX wikis_by_category   ON vault.wikis (space_id, category_id);
CREATE INDEX wikis_uncategorized ON vault.wikis (space_id) WHERE category_id IS NULL;
CREATE INDEX wikis_title_bigm    ON vault.wikis USING gin (title gin_bigm_ops);

-- 세션의 대표 wiki ------------------------------------------------------------------
ALTER TABLE vault.sessions
  ADD COLUMN wiki_id uuid REFERENCES vault.wikis(node_id) ON DELETE SET NULL;  -- 비어 있으면 도착 구역
CREATE INDEX sessions_by_wiki ON vault.sessions (space_id, wiki_id);
CREATE INDEX sessions_inbox   ON vault.sessions (space_id, last_revision_at DESC) WHERE wiki_id IS NULL;

-- 선 종류: 소속(belongs)은 대표 열로 옮겼으므로 뺀다 ------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM vault.edges WHERE kind IN ('belongs', 'related')) THEN
    RAISE EXCEPTION 'belongs·related 선이 남아 있어요. 대표 열이나 새 선 종류로 먼저 옮겨야 해요';
  END IF;
END $$;
DELETE FROM vault.edge_kinds WHERE name IN ('belongs', 'related');
INSERT INTO vault.edge_kinds (name, directed, ai_creatable, description) VALUES
  ('material', true,  true, '세션 → 대표가 아닌 다른 wiki의 재료'),
  ('link',     false, true, 'wiki ↔ wiki 링크');
UPDATE vault.edge_kinds SET description = '세션 ↔ 세션, 의미 검색으로 계산한 비슷함' WHERE name = 'similar';

-- 글의 대표 wiki와 참고 wiki (blog 모듈. vault를 가리키는 값이라 외래키 없음) ----------------
ALTER TABLE blog.posts ADD COLUMN main_wiki_id uuid;  -- 대표. 비어 있으면 그래프에 나오지 않음
CREATE INDEX posts_by_main_wiki ON blog.posts (space_id, main_wiki_id) WHERE main_wiki_id IS NOT NULL;
CREATE TABLE blog.post_wiki_refs (
  post_id   uuid NOT NULL REFERENCES blog.posts(id) ON DELETE CASCADE,
  wiki_id   uuid NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, wiki_id)
);
CREATE INDEX post_wiki_refs_by_wiki ON blog.post_wiki_refs (wiki_id);

-- migrate:down
DROP TABLE blog.post_wiki_refs;
DROP INDEX blog.posts_by_main_wiki;
ALTER TABLE blog.posts DROP COLUMN main_wiki_id;

DELETE FROM vault.edges WHERE kind IN ('material', 'link');
DELETE FROM vault.edge_kinds WHERE name IN ('material', 'link');
INSERT INTO vault.edge_kinds (name, directed, ai_creatable, description) VALUES
  ('belongs', true,  true, '세션 → 주제 소속'),
  ('related', false, true, '세션↔세션, 주제↔주제 관련');
UPDATE vault.edge_kinds SET description = '의미 검색으로 계산한 비슷함' WHERE name = 'similar';

DROP INDEX vault.sessions_inbox;
DROP INDEX vault.sessions_by_wiki;
ALTER TABLE vault.sessions DROP COLUMN wiki_id;

DELETE FROM vault.nodes WHERE kind = 'wiki';
DROP TABLE vault.wikis;

DROP INDEX vault.categories_sort_idx;
ALTER TABLE vault.categories DROP COLUMN sort;
COMMENT ON COLUMN vault.categories.description IS NULL;
ALTER INDEX vault.categories_name_bigm RENAME TO topics_name_bigm;
ALTER TABLE vault.categories RENAME CONSTRAINT categories_node_id_fkey TO topics_node_id_fkey;
ALTER TABLE vault.categories RENAME CONSTRAINT categories_origin_check TO topics_origin_check;
ALTER TABLE vault.categories RENAME CONSTRAINT categories_space_id_slug_key TO topics_space_id_slug_key;
ALTER TABLE vault.categories RENAME CONSTRAINT categories_pkey TO topics_pkey;
ALTER TABLE vault.categories RENAME TO topics;

INSERT INTO vault.node_kinds (name, detail_table, description) VALUES ('topic', 'vault.topics', '세션을 묶는 주제');
UPDATE vault.nodes SET kind = 'topic' WHERE kind = 'category';
DELETE FROM vault.node_kinds WHERE name IN ('category', 'wiki');
