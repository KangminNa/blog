-- migrate:up
-- 토큰 사용량과 한도. 5시간 토큰 한도나 구독 사용률에 닿은 에이전트는 새 일만 쉬었다가 저절로 다시 일한다.
--   쉬는 중인지는 저장하지 않고 그때마다 계산한다.

ALTER TABLE task.agents
  ADD COLUMN five_hour_limit bigint CHECK (five_hour_limit > 0),                  -- 5시간 토큰 한도. 비어 있으면 한도 없음
  ADD COLUMN plan_stop_percent int CHECK (plan_stop_percent BETWEEN 1 AND 100);   -- 이 구독 사용률에서 새 일을 쉰다

-- AI 도구 구독의 사용률. 러너가 본 마지막 값 하나만 둔다. window는 예약어라 열 이름은 period다
CREATE TABLE task.plan_usage (
  space_id   uuid NOT NULL,
  tool       text NOT NULL CHECK (tool IN ('claude', 'codex')),
  period     text NOT NULL CHECK (period IN ('five_hour', 'seven_day')),
  percent    int NOT NULL CHECK (percent BETWEEN 0 AND 1000),   -- 초과 사용이면 100을 넘는다
  resets_at  timestamptz NOT NULL,                              -- 지나면 확인 전으로 본다
  status     text CHECK (status IN ('allowed', 'allowed_warning', 'rejected')),   -- CLI가 알리지 않으면 비어 있다
  seen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, tool, period)
);

-- 5시간·이번 달 사용량. 일을 빌릴 때마다 읽으므로 토큰이 있는 최근 기록만 훑는다
CREATE INDEX task_events_tokens_idx ON task.task_events (at) WHERE tokens > 0;

-- migrate:down
DROP INDEX task.task_events_tokens_idx;
DROP TABLE task.plan_usage;
ALTER TABLE task.agents
  DROP COLUMN plan_stop_percent,
  DROP COLUMN five_hour_limit;
