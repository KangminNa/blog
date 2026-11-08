-- migrate:up
-- 기능 패키지 browser-tabs의 자기 스키마. 코어 표에 외래키를 걸지 않는다 (space_id는 값으로만)
CREATE SCHEMA browser_tabs;

-- 읽어 달라고 한 주소 하나와 그 결과. 주인이 요청하고(requested) 러너가 읽어 남긴다(done · failed)
CREATE TABLE browser_tabs.reads (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  url text NOT NULL CHECK (url ~ '^https?://' AND char_length(url) <= 2000),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'done', 'failed')),
  title text,
  body text,
  error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
CREATE INDEX reads_space_idx ON browser_tabs.reads (space_id, id DESC);
CREATE INDEX reads_pending_idx ON browser_tabs.reads (space_id, id) WHERE status = 'requested';

-- migrate:down
DROP SCHEMA browser_tabs CASCADE;
