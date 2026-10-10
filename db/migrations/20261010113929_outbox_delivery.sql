-- migrate:up
-- 일꾼이 outbox의 이벤트를 받는 쪽(Handler)에 넘긴다.
--   빌려 갈 때 next_attempt_at을 2분 뒤로 미뤄 두고(그동안 다른 일꾼이 같은 이벤트를 잡지 않음),
--   성공하면 processed_at, 실패하면 last_error를 남기고 점점 늦게 다시 시도한다.
--   여러 번 실패하면 failed_at을 찍고 멈춘다 (지우지 않고 남겨 원인을 볼 수 있게).
ALTER TABLE platform.outbox
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_error      text,
  ADD COLUMN failed_at       timestamptz;

DROP INDEX platform.outbox_pending_idx;
CREATE INDEX outbox_pending_idx ON platform.outbox (next_attempt_at NULLS FIRST, id)
  WHERE processed_at IS NULL AND failed_at IS NULL;

-- migrate:down
DROP INDEX platform.outbox_pending_idx;
CREATE INDEX outbox_pending_idx ON platform.outbox (id) WHERE processed_at IS NULL;
ALTER TABLE platform.outbox
  DROP COLUMN failed_at,
  DROP COLUMN last_error,
  DROP COLUMN next_attempt_at;
