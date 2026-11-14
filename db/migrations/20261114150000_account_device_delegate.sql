-- migrate:up
-- 기기 권한 delegate (2026-11-14 사용자 결정): 내 컴퓨터의 AI 도구가 MCP로 서버 팀(관리자 바로 아래 에이전트)에 일을 맡기고 답을 받는다.
-- 관리자가 기기 메뉴에서 켠다. 결재(승인 · 반려)는 여전히 콘솔에서만이다. 칸 기기는 받지 못한다 (devices_sandbox_only).
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'sandbox', 'delegate']::text[]);

-- migrate:down
UPDATE account.devices SET scopes = array_remove(scopes, 'delegate');
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'sandbox']::text[]);
