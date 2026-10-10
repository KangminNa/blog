-- migrate:up
-- 설치와 주인 로그인 (M1 A)
--   주인은 공간마다 한 명. 처음 로그인한 GitHub 계정이 주인이 되고, 동시에 두 계정이 주인이 되려 하면 DB가 막는다.
--   블로그 이름·소개를 낙관적 잠금으로 고치도록 공간에 version을 둔다.

CREATE UNIQUE INDEX space_members_one_owner ON account.space_members (space_id) WHERE role = 'owner';

ALTER TABLE account.spaces ADD COLUMN version int NOT NULL DEFAULT 1;

-- migrate:down
ALTER TABLE account.spaces DROP COLUMN version;

DROP INDEX account.space_members_one_owner;
