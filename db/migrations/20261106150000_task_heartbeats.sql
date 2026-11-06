-- migrate:up
-- 에이전트 조직 3: 하트비트 (2026-11-06). 에이전트를 정해진 시각에 깨워 자기 일을 확인하게 한다.
--   에이전트마다 한 줄. 주기는 둘뿐이다: 매일 정한 시각(요일 고르기), 또는 N시간마다. 크론 문법은 두지 않는다.
--   일꾼이 1분마다 next_run_at이 지난 것을 잠가(SKIP LOCKED) 작업을 만든다. 작업의 request_id가
--   heartbeat:<에이전트>:<시각>이라 일꾼이 두 번 돌아도 작업은 하나다. MVP 7단계의 스케줄은 여기서 시작한다.

CREATE TABLE task.heartbeats (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  agent_id     uuid NOT NULL UNIQUE REFERENCES task.agents(id),
  mode         text NOT NULL CHECK (mode IN ('daily', 'hourly')),
  at_minute    int CHECK (at_minute BETWEEN 0 AND 1439),        -- daily: 시간대 기준 하루 중 분 (09:30 → 570)
  weekdays     int[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}'          -- daily: ISO 요일 (월 1 ~ 일 7)
               CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
  every_hours  int CHECK (every_hours BETWEEN 1 AND 24),        -- hourly: 시간대 기준 정각, 시가 N으로 나누어떨어질 때
  time_zone    text NOT NULL,                                   -- IANA 이름 (Asia/Seoul)
  instruction  text NOT NULL DEFAULT '',
  goal_id      uuid REFERENCES task.goals(id),                  -- 만드는 작업이 향하는 목표
  enabled      boolean NOT NULL DEFAULT false,
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heartbeats_daily_check CHECK ((mode = 'daily') = (at_minute IS NOT NULL)),
  CONSTRAINT heartbeats_hourly_check CHECK ((mode = 'hourly') = (every_hours IS NOT NULL)),
  CONSTRAINT heartbeats_next_check CHECK (enabled = (next_run_at IS NOT NULL))
);
CREATE INDEX heartbeats_due_idx ON task.heartbeats (next_run_at) WHERE enabled;   -- 일꾼이 때가 된 것 찾기
CREATE INDEX heartbeats_goal_idx ON task.heartbeats (goal_id);                    -- 외래키

-- migrate:down
DROP TABLE task.heartbeats;
