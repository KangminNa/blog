-- migrate:up
-- 브라우저 에이전트 (2026-11-08): 서버 브라우저로 하는 작업(browse)을 맡는 권한.
-- 로그인된 브라우저를 쓰는 에이전트는 비공개를 읽지 않는다: browse와 read_all은 함께 줄 수 없다 (Agent의 규칙과 같다)
ALTER TABLE task.agents DROP CONSTRAINT agents_scopes_check;
ALTER TABLE task.agents ADD CONSTRAINT agents_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse']::text[]);
ALTER TABLE task.agents ADD CONSTRAINT agents_browse_not_private
  CHECK (NOT (scopes @> ARRAY['browse', 'read_all']::text[]));

-- migrate:down
UPDATE task.agents SET scopes = array_remove(scopes, 'browse') WHERE 'browse' = ANY (scopes);
ALTER TABLE task.agents DROP CONSTRAINT agents_browse_not_private;
ALTER TABLE task.agents DROP CONSTRAINT agents_scopes_check;
ALTER TABLE task.agents ADD CONSTRAINT agents_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write']::text[]);
