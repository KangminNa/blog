-- migrate:up
-- 7단계 브라우저 푸시 (2026-11-11 사용자 결정). 구독은 브라우저 하나에 한 줄 (endpoint가 유일).
-- 보내는 일꾼이 공간마다 구독을 찾으므로 공간 칸을 더한다 (아직 쓰는 곳이 없어 줄이 없다).
-- push_sent_at은 "푸시를 다룬 때"다: 보냈거나, 경로가 알림 센터만이라 보내지 않기로 했거나, 하루가 지나 버렸을 때.
ALTER TABLE platform.push_subscriptions ADD COLUMN space_id uuid NOT NULL;
CREATE INDEX push_subscriptions_space_idx ON platform.push_subscriptions (space_id);
-- 일꾼이 아직 다루지 않은 알림 찾기 (기록만 등급은 보내지 않는다)
CREATE INDEX notifications_push_idx ON platform.notifications (space_id, created_at)
  WHERE push_sent_at IS NULL AND severity <> 'log';

-- migrate:down
DROP INDEX platform.notifications_push_idx;
DROP INDEX platform.push_subscriptions_space_idx;
ALTER TABLE platform.push_subscriptions DROP COLUMN space_id;
