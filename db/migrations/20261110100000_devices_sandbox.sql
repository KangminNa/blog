-- migrate:up
-- 코드 러너 칸 (docs/코드작업.md 2단계): 칸 기기만 가진 권한 sandbox. 셸이 있는 일(code)은 이 권한의 기기에만 빌려 준다.
-- 칸으로 연결할 때만 생기고(POST /api/devices/code-runner) 주인이 줄 수 없다. sandbox 기기는 run과 sandbox만 가진다:
-- 셸이 있는 칸의 기기가 비공개 읽기나 쓰기 권한까지 갖지 않게
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'sandbox']::text[]);
ALTER TABLE account.devices ADD CONSTRAINT devices_sandbox_only
  CHECK (NOT ('sandbox' = ANY (scopes)) OR scopes <@ ARRAY['run', 'sandbox']::text[]);

-- migrate:down
UPDATE account.devices SET scopes = array_remove(scopes, 'sandbox') WHERE 'sandbox' = ANY (scopes);
ALTER TABLE account.devices DROP CONSTRAINT devices_sandbox_only;
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run']::text[]);
