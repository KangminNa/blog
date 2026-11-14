-- migrate:up
-- 기기 권한 news (2차 1-3): 대화의 소식만 읽는다 (MCP agent_updates). cairn connect가 OAuth 승인 요청에 scope=news를 실어
-- 내 컴퓨터의 훅 · 상태 줄이 쓰는 소식 기기를 따로 만든다. 다른 권한과 함께 두지 않는다 (Device 규칙과 같은 막기).
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'sandbox', 'delegate', 'news']::text[]);
ALTER TABLE account.devices ADD CONSTRAINT devices_news_only
  CHECK (NOT ('news' = ANY (scopes)) OR scopes = ARRAY['news']::text[]);

-- migrate:down
ALTER TABLE account.devices DROP CONSTRAINT devices_news_only;
UPDATE account.devices SET scopes = array_remove(scopes, 'news');
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'sandbox', 'delegate']::text[]);
