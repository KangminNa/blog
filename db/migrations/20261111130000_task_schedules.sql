-- migrate:up
-- 7단계 스케줄 (2026-11-11 사용자 결정): 하트비트를 스케줄로 넓힌다. 하트비트는 "담당이 정해져 있고 지시가 기본값인 스케줄"이다.
--   공간에 여러 줄. 정한 시각에 지시대로 작업을 만든다. 담당이 없으면 빌릴 때 자동 배정.
--   주기는 하트비트와 같다: 매일 정한 시각(요일 고르기) 또는 N시간마다. 크론 문법은 두지 않는다.
--   하루 한도: 스케줄의 시간대 기준 하루(run_day)에 만든 작업 수(day_runs)가 daily_max에 닿으면 건너뛴다.
--   일꾼이 1분마다 next_run_at이 지난 것을 잠가(SKIP LOCKED) 작업을 만든다. 작업의 request_id가
--   schedule:<스케줄>:<시각>이라 일꾼이 두 번 돌아도 작업은 하나다.
-- 하트비트 줄은 같은 id로 옮긴다 (제목 "정기 확인", 하루 한도는 그동안 돌던 만큼).

CREATE TABLE task.schedules (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  agent_id     uuid REFERENCES task.agents(id),                 -- 없으면 빌릴 때 자동 배정
  mode         text NOT NULL CHECK (mode IN ('daily', 'hourly')),
  at_minute    int CHECK (at_minute BETWEEN 0 AND 1439),        -- daily: 시간대 기준 하루 중 분 (09:30 → 570)
  weekdays     int[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}'          -- daily: ISO 요일 (월 1 ~ 일 7)
               CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
  every_hours  int CHECK (every_hours BETWEEN 1 AND 24),        -- hourly: 시간대 기준 정각, 시가 N으로 나누어떨어질 때
  time_zone    text NOT NULL,                                   -- IANA 이름 (Asia/Seoul)
  instruction  text NOT NULL DEFAULT '',
  goal_id      uuid REFERENCES task.goals(id),                  -- 만드는 작업이 향하는 목표
  daily_max    int NOT NULL DEFAULT 3 CHECK (daily_max BETWEEN 1 AND 24),
  run_day      text CHECK (run_day ~ '^\d{4}-\d{2}-\d{2}$'),     -- day_runs를 센 날 (시간대 기준 "2026-11-06")
  day_runs     int NOT NULL DEFAULT 0 CHECK (day_runs >= 0),
  enabled      boolean NOT NULL DEFAULT false,
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedules_daily_check CHECK ((mode = 'daily') = (at_minute IS NOT NULL)),
  CONSTRAINT schedules_hourly_check CHECK ((mode = 'hourly') = (every_hours IS NOT NULL)),
  CONSTRAINT schedules_next_check CHECK (enabled = (next_run_at IS NOT NULL))
);
CREATE INDEX schedules_due_idx ON task.schedules (next_run_at) WHERE enabled;   -- 일꾼이 때가 된 것 찾기
CREATE INDEX schedules_space_idx ON task.schedules (space_id, id);              -- 스케줄 메뉴의 목록
CREATE INDEX schedules_agent_idx ON task.schedules (agent_id);                  -- 외래키, 에이전트 화면의 스케줄
CREATE INDEX schedules_goal_idx ON task.schedules (goal_id);                    -- 외래키

INSERT INTO task.schedules
  (id, space_id, title, agent_id, mode, at_minute, weekdays, every_hours, time_zone, instruction, goal_id,
   daily_max, enabled, next_run_at, last_run_at, version, created_at)
SELECT id, space_id, '정기 확인', agent_id, mode, at_minute, weekdays, every_hours, time_zone, instruction, goal_id,
       CASE WHEN mode = 'daily' THEN 1 ELSE LEAST(24, CEIL(24.0 / every_hours)::int) END,
       enabled, next_run_at, last_run_at, version, created_at
FROM task.heartbeats;

DROP TABLE task.heartbeats;

-- migrate:down
CREATE TABLE task.heartbeats (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  agent_id     uuid NOT NULL UNIQUE REFERENCES task.agents(id),
  mode         text NOT NULL CHECK (mode IN ('daily', 'hourly')),
  at_minute    int CHECK (at_minute BETWEEN 0 AND 1439),
  weekdays     int[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}'
               CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
  every_hours  int CHECK (every_hours BETWEEN 1 AND 24),
  time_zone    text NOT NULL,
  instruction  text NOT NULL DEFAULT '',
  goal_id      uuid REFERENCES task.goals(id),
  enabled      boolean NOT NULL DEFAULT false,
  next_run_at  timestamptz,
  last_run_at  timestamptz,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heartbeats_daily_check CHECK ((mode = 'daily') = (at_minute IS NOT NULL)),
  CONSTRAINT heartbeats_hourly_check CHECK ((mode = 'hourly') = (every_hours IS NOT NULL)),
  CONSTRAINT heartbeats_next_check CHECK (enabled = (next_run_at IS NOT NULL))
);
CREATE INDEX heartbeats_due_idx ON task.heartbeats (next_run_at) WHERE enabled;
CREATE INDEX heartbeats_goal_idx ON task.heartbeats (goal_id);

-- 에이전트마다 하나만 돌아간다 (담당이 있는 스케줄 중 먼저 만든 것)
INSERT INTO task.heartbeats
  (id, space_id, agent_id, mode, at_minute, weekdays, every_hours, time_zone, instruction, goal_id,
   enabled, next_run_at, last_run_at, version, created_at)
SELECT DISTINCT ON (agent_id)
       id, space_id, agent_id, mode, at_minute, weekdays, every_hours, time_zone, instruction, goal_id,
       enabled, next_run_at, last_run_at, version, created_at
FROM task.schedules WHERE agent_id IS NOT NULL
ORDER BY agent_id, id;

DROP TABLE task.schedules;
