-- migrate:up
-- 페이지 (2026-11-12 사용자 결정): AI가 만든 HTML 묶음을 블로그처럼 바깥 주소(/pages/<이름>/)로 내보낸다.
--   만들기 작업이 끝나면 task가 이벤트(task.page.built)로 파일 목록을 알리고, blog가 판을 쌓아 그 판을 바로 보이게 한다.
--   기본은 주인만 보고(private), 방문자에게 보이게 하는 것은 주인이 정한다. 고쳐 달라마다 새 판이 쌓이고 보이는 판을 옮길 수 있다.
--   파일은 platform.blobs를 값으로 가리킨다 (files의 blobHash). 모듈 사이 외래키는 없다: task_id · run_id는 값이다.
CREATE TABLE blog.pages (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  name         text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),      -- 주소에 쓰는 이름 (/pages/<name>/)
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  visibility   text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  current_seq  int NOT NULL CHECK (current_seq >= 1),                         -- 지금 보이는 판
  revisions    int NOT NULL CHECK (revisions >= 1),                           -- 쌓인 판 수
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pages_name_unique UNIQUE (space_id, name),                       -- 주소 하나에 페이지 하나
  CONSTRAINT pages_current_check CHECK (current_seq <= revisions)
);

-- 판: 추가만 한다. 판 하나 = 작업 한 번의 실행이 만든 파일 묶음
CREATE TABLE blog.page_revisions (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  page_id     uuid NOT NULL REFERENCES blog.pages(id),
  seq         int NOT NULL CHECK (seq >= 1),
  files       jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array'),           -- [{ name, blobHash, mime, sizeBytes }]
  task_id     uuid NOT NULL,                                                  -- 만든 작업 (task의 것, 값)
  run_id      uuid NOT NULL,                                                  -- 만든 실행 (task의 것, 값)
  note        text NOT NULL DEFAULT '',                                       -- 그때의 요청 글
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT page_revisions_seq UNIQUE (page_id, seq),                        -- 판 하나 · 판 목록
  CONSTRAINT page_revisions_run UNIQUE (page_id, run_id)                      -- 같은 이벤트를 두 번 받아도 판은 하나
);
CREATE TRIGGER page_revisions_append_only
  BEFORE UPDATE OR DELETE ON blog.page_revisions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- migrate:down
DROP TABLE blog.page_revisions;
DROP TABLE blog.pages;
