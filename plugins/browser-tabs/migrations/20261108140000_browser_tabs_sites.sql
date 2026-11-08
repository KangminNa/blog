-- migrate:up
-- 브라우저 에이전트가 일하는 사이트 (2026-11-08). 주인이 등록하고, 작업을 맡길 때 그때의 값이 작업 payload에 실린다.
-- origins는 브라우저가 요청할 수 있는 출처(Playwright MCP의 --allowed-origins, 가드레일)이고, 시작 주소는 그 안에 있어야 한다
CREATE TABLE browser_tabs.sites (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  start_url text NOT NULL CHECK (start_url ~ '^https?://' AND char_length(start_url) <= 2000),
  origins text[] NOT NULL CHECK (cardinality(origins) BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
-- 콘솔 목록 (공간의 사이트, 최근 것부터)
CREATE INDEX sites_space_idx ON browser_tabs.sites (space_id, id DESC);

-- migrate:down
DROP TABLE browser_tabs.sites;
