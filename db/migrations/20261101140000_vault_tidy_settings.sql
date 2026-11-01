-- migrate:up
-- 세션 자동 정리 설정. 공간마다 한 행이고, 행이 없으면 꺼짐이다.
--   저장할 때마다 주인의 구독 토큰을 쓰므로 기본은 끈다 (주인이 설정에서 켠다).

CREATE TABLE vault.tidy_settings (
  space_id    uuid PRIMARY KEY,                  -- account 모듈의 값 (모듈 사이 외래키 없음)
  auto_tidy   boolean NOT NULL DEFAULT false,
  version     int NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE vault.tidy_settings;
