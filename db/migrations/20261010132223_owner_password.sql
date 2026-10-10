-- migrate:up
-- 주인 로그인을 비밀번호로 (2026-10-10 결정 B). GitHub 로그인은 플러그인(login-github)으로 옮긴다.
--   users: 아이디(login)와 비밀번호(scrypt로 바꾼 값만). GitHub 계정 열은 login_links로 옮기고 뺀다.
--   login_links: 로그인 플러그인으로 들어온 외부 계정(GitHub 등)과 주인의 연결. 연결된 계정으로만 주인 로그인이 된다.
--   공간 설정의 GitHub 앱 값은 코어에서 쓰지 않으므로 지운다 (플러그인 설정으로 다시 넣는다).

CREATE TABLE account.login_links (
  method      text NOT NULL,                                -- 로그인 방법 (플러그인이 정한 이름, 예: github)
  subject     text NOT NULL,                                -- 그 서비스의 계정 id (GitHub 숫자 id 등)
  user_id     uuid NOT NULL REFERENCES account.users(id) ON DELETE CASCADE,
  label       text,                                         -- 화면에 보일 이름 (GitHub login 등)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (method, subject)
);
CREATE INDEX login_links_user ON account.login_links (user_id);

INSERT INTO account.login_links (method, subject, user_id, label)
SELECT 'github', github_user_id::text, id, github_login FROM account.users;

ALTER TABLE account.users
  ADD COLUMN login text,
  ADD COLUMN password_hash text,                            -- "scrypt$N$r$p$salt$hash". 원문은 어디에도 두지 않는다
  ADD COLUMN password_changed_at timestamptz;
-- 이미 있던 계정(개발 데이터)은 GitHub login을 아이디로 쓴다. 비밀번호는 pnpm owner reset-password로 정한다
UPDATE account.users
SET login = left(regexp_replace(lower(coalesce(github_login, 'owner')), '[^a-z0-9_-]', '-', 'g') || '-' || left(id::text, 4), 40);
ALTER TABLE account.users
  ALTER COLUMN login SET NOT NULL,
  ADD CONSTRAINT users_login_key UNIQUE (login),
  ADD CONSTRAINT users_login_check CHECK (login ~ '^[a-z0-9_-]{3,40}$'),
  DROP COLUMN github_user_id,
  DROP COLUMN github_login;

DELETE FROM account.settings WHERE key IN ('github.client_id', 'github.url', 'github.api_url');
DELETE FROM account.secrets WHERE key = 'github.client_secret';

-- migrate:down
-- 비밀번호로만 있던 계정은 GitHub 열을 채울 수 없어 되돌릴 때 지운다 (개발 단계에서만 일어남)
ALTER TABLE account.users
  ADD COLUMN github_user_id bigint,
  ADD COLUMN github_login text;
UPDATE account.users u
SET github_user_id = l.subject::bigint, github_login = l.label
FROM account.login_links l
WHERE l.user_id = u.id AND l.method = 'github';
DELETE FROM account.users WHERE github_user_id IS NULL;
ALTER TABLE account.users
  ALTER COLUMN github_user_id SET NOT NULL,
  ADD CONSTRAINT users_github_user_id_key UNIQUE (github_user_id),
  DROP CONSTRAINT users_login_check,
  DROP CONSTRAINT users_login_key,
  DROP COLUMN password_changed_at,
  DROP COLUMN password_hash,
  DROP COLUMN login;

DROP TABLE account.login_links;
