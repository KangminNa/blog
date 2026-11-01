-- migrate:up
-- 세션마다 정리를 마지막으로 요청한 판 번호. 0이면 아직 요청한 적이 없다.
--   이 값이 지금 판(revision_count)보다 뒤처진 세션만 쌓인 세션 정리가 고른다.
--   실패한 세션은 새 판이 쌓여야 다시 고른다: 같은 판의 일 요청은 requestId가 같아 작업이 새로 생기지 않는다.

ALTER TABLE vault.sessions
  ADD COLUMN tidy_requested_seq int NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE vault.sessions
  DROP COLUMN tidy_requested_seq;
