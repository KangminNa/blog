-- migrate:up
-- 7단계 알림 설정 (2026-11-11 사용자 결정): 공간마다 한 줄. 줄이 없으면 기본값이다.
--   digest: 묶음 등급 알림을 보내는 간격 (hourly: 매시 정각, daily: digest_minute에 하루 한 번)
--   quiet_start · quiet_end: 조용한 시간 (시간대 기준 하루 중 분). 그동안 푸시는 미뤘다가 끝날 때 모아 보낸다. 둘 다 비면 없음
--   routes: 알림 종류 → push · center · off. 없는 종류는 등급의 기본 (즉시 · 묶음은 push, 기록만은 center)
CREATE TABLE platform.notice_settings (
  space_id       uuid PRIMARY KEY,
  digest         text NOT NULL DEFAULT 'hourly' CHECK (digest IN ('hourly', 'daily')),
  digest_minute  int NOT NULL DEFAULT 540 CHECK (digest_minute BETWEEN 0 AND 1439),
  quiet_start    int CHECK (quiet_start BETWEEN 0 AND 1439),
  quiet_end      int CHECK (quiet_end BETWEEN 0 AND 1439),
  time_zone      text NOT NULL DEFAULT 'UTC',
  routes         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(routes) = 'object'),
  version        int NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notice_settings_quiet_check CHECK ((quiet_start IS NULL) = (quiet_end IS NULL))
);

-- migrate:down
DROP TABLE platform.notice_settings;
