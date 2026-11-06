-- migrate:up
-- 웹 AI 로그인 (2026-11-06). 러너가 로그인 명령(claude setup-token, codex login --device-auth)을 대신 돌리고
-- 받은 자격을 저장한다. Codex의 자격은 갱신 토큰이 든 auth.json이라 만료를 알 수 없어 비워 둔다.
-- Claude의 setup-token은 지금처럼 저장한 날부터 1년.

ALTER TABLE task.ai_logins ALTER COLUMN expires_at DROP NOT NULL;

-- migrate:down
UPDATE task.ai_logins SET expires_at = created_at + interval '1 year' WHERE expires_at IS NULL;
ALTER TABLE task.ai_logins ALTER COLUMN expires_at SET NOT NULL;
