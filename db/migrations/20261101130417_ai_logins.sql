-- migrate:up
-- AI 도구의 로그인. 콘솔에 넣은 토큰을 서버 키로 암호화해 두고, 서버 러너가 ai_login으로 일마다 받아 간다.
CREATE TABLE task.ai_logins (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id    uuid NOT NULL,
  tool        text NOT NULL CHECK (tool IN ('claude', 'codex')),
  secret      bytea NOT NULL,        -- 서버 키로 암호화한 토큰
  nonce       bytea NOT NULL,        -- 암호화에 쓴 nonce (값마다 새로)
  expires_at  timestamptz NOT NULL,  -- 저장한 날부터 1년. CLI가 남은 기간을 알려 주지 않는다
  checked_at  timestamptz,           -- 마지막 연결 확인. 비어 있으면 확인 전
  last_error  text,                  -- 마지막 연결 확인이 실패한 이유
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (space_id, tool)
);

-- migrate:down
DROP TABLE task.ai_logins;
