-- migrate:up
-- MCP 도구의 글을 콘솔에서 고친 판 (2차 1-0, 기획서 결정 2026-11-14). 기본은 코드 밖 설명서(<모듈>.tools.ko.json)와
-- 기능 패키지의 목록 파일이고, 주인이 콘솔 "도구 설명"에서 쌓은 판이 그 위에 얹힌다. 판은 추가만 하고,
-- 도구마다 지금 쓰는 판(active_revision)을 가리킨다. 비어 있으면 기본 글을 쓴다 (기본으로 되돌리기).
CREATE TABLE mcp.tool_texts (
  id               uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id         uuid NOT NULL,
  tool             text NOT NULL CHECK (tool ~ '^[a-z][a-z0-9_]{0,63}$'),
  active_revision  int CHECK (active_revision > 0),                 -- 비어 있으면 기본 글
  revisions        int NOT NULL DEFAULT 0 CHECK (revisions >= 0),   -- 마지막 판 번호
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_texts_space_tool UNIQUE (space_id, tool),          -- 도구 목록을 낼 때 공간의 판을 함께 읽는다
  CONSTRAINT tool_texts_active_exists CHECK (active_revision IS NULL OR active_revision <= revisions)
);

CREATE TABLE mcp.tool_text_revisions (
  id            uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  tool_text_id  uuid NOT NULL REFERENCES mcp.tool_texts(id),
  revision      int NOT NULL CHECK (revision > 0),
  description   text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4000),
  input         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(input) = 'object'),   -- { "칸 경로": "설명" } (빠진 칸은 기본 글)
  based_on      text NOT NULL CHECK (based_on ~ '^[0-9a-f]{64}$'),   -- 고칠 때 기본 글의 해시 (배포로 기본이 바뀌었는지 알리려고)
  note          text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_text_revisions_number UNIQUE (tool_text_id, revision)   -- 판 하나 읽기 · 판 목록
);
CREATE TRIGGER tool_text_revisions_append_only
  BEFORE UPDATE OR DELETE ON mcp.tool_text_revisions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- migrate:down
DROP TABLE mcp.tool_text_revisions;
DROP TABLE mcp.tool_texts;
