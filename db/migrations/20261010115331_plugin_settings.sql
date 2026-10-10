-- migrate:up
-- 플러그인 켜기·설정은 DB에. 설치 마법사·관리 화면(·화면 전에는 명령줄)에서 바꾸고, 재시작 없이 반영한다.
-- 비밀값은 서버 키(CAIRN_SECRET_KEY)로 암호화해서만 저장하고, 화면에는 "설정됨"만 보인다.

CREATE TABLE platform.plugins (
  name          text PRIMARY KEY,                 -- plugins/<이름>
  enabled       boolean NOT NULL DEFAULT false,
  version       text NOT NULL,                    -- 켤 때의 플러그인 버전
  granted_uses  text[] NOT NULL DEFAULT '{}',     -- 켤 때 주인이 허락한 확장 지점. 새 버전이 더 달라고 하면 다시 허락받기 전까지 동작하지 않음
  enabled_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

CREATE TABLE platform.plugin_settings (
  plugin             text NOT NULL REFERENCES platform.plugins(name) ON DELETE CASCADE,
  key                text NOT NULL,
  value              text,          -- 비밀이 아닌 값
  secret_ciphertext  bytea,         -- 비밀값 (AES-256-GCM, 인증 태그 포함)
  secret_nonce       bytea,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         text,
  PRIMARY KEY (plugin, key),
  CHECK ((value IS NULL) <> (secret_ciphertext IS NULL)),
  CHECK ((secret_ciphertext IS NULL) = (secret_nonce IS NULL))
);

-- migrate:down
DROP TABLE platform.plugin_settings;
DROP TABLE platform.plugins;
