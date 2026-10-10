-- migrate:up
-- 기기 연결 (M1 B, MCP OAuth 2.1)
--   oauth_codes: 승인 코드를 받을 주소. 토큰으로 바꿀 때 같은 주소여야 한다 (OAuth 규격)
--   devices: 이름은 끊지 않은 기기 사이에서만 겹치지 않으면 된다 (끊은 기기의 이름은 다시 쓸 수 있게)
--            이름·권한을 낙관적 잠금으로 고치도록 version

ALTER TABLE account.oauth_codes ADD COLUMN redirect_uri text NOT NULL DEFAULT '';
ALTER TABLE account.oauth_codes ALTER COLUMN redirect_uri DROP DEFAULT;

ALTER TABLE account.devices DROP CONSTRAINT devices_space_id_name_key;
CREATE UNIQUE INDEX devices_live_name ON account.devices (space_id, name) WHERE revoked_at IS NULL;
ALTER TABLE account.devices ADD COLUMN version int NOT NULL DEFAULT 1;

-- migrate:down
ALTER TABLE account.devices DROP COLUMN version;
DROP INDEX account.devices_live_name;
ALTER TABLE account.devices ADD CONSTRAINT devices_space_id_name_key UNIQUE (space_id, name);

ALTER TABLE account.oauth_codes DROP COLUMN redirect_uri;
