-- migrate:up
-- 목표 실행 (2026-11-13 사용자 결정): 목표를 이룰 때까지 팀장 에이전트가 회차를 이어 돈다. 주인은 결재문만 받는다.
--   회차 하나 = 팀장에게 맡긴 작업 하나 (팀에게 나눠 맡길 수 있다). 팀장은 끝내기 전에 report_round로 보고를 남긴다.
--   회차가 끝나면 서버가 정한다: 다 됐다고 하면 최종 결재, 결재 시점 · 회차 한도 · 진전 없음이면 중간 결재, 아니면 다음 회차.
--   결재 대상은 실행(target_kind 'goal_run')이고, 승인 · 고쳐 달라 · 거절에 따라 다음 회차 · 완료 · 멈춤.

CREATE TABLE task.goal_runs (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  goal_id      uuid NOT NULL REFERENCES task.goals(id),
  agent_id     uuid NOT NULL REFERENCES task.agents(id),          -- 팀장
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  instruction  text NOT NULL CHECK (char_length(instruction) BETWEEN 1 AND 4000),   -- 주인이 쓴 지시 (read_url의 기준)
  criteria     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(criteria) <= 20),     -- 완료 조건
  checkpoint   text NOT NULL CHECK (checkpoint IN ('every', 'milestone', 'final')), -- 중간 결재를 받을 때
  round        int NOT NULL DEFAULT 1 CHECK (round >= 1),          -- 지금 회차
  max_rounds   int NOT NULL CHECK (max_rounds BETWEEN 1 AND 50),   -- 넘으면 멈추고 묻는다 (승인하면 한 회차씩 늘어난다)
  status       text NOT NULL CHECK (status IN ('running', 'waiting', 'done', 'stopped')),
  request_id   text NOT NULL,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  CONSTRAINT goal_runs_request UNIQUE (space_id, request_id),
  CONSTRAINT goal_runs_finished CHECK ((status IN ('done', 'stopped')) = (finished_at IS NOT NULL))
);
CREATE INDEX goal_runs_space_idx ON task.goal_runs (space_id, id DESC);   -- 목표 메뉴의 목록
CREATE INDEX goal_runs_goal_idx ON task.goal_runs (goal_id);              -- 외래키
CREATE INDEX goal_runs_agent_idx ON task.goal_runs (agent_id);            -- 외래키

-- 회차 보고 (추가만). 팀장이 report_round로 남긴다. 회차마다 하나
CREATE TABLE task.goal_rounds (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  run_id       uuid NOT NULL REFERENCES task.goal_runs(id),
  round        int NOT NULL CHECK (round >= 1),
  task_id      uuid NOT NULL REFERENCES task.tasks(id),
  summary      text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  completed    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(completed) <= 30),
  remaining    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(remaining) <= 30),
  evidence     jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array'),   -- [{ url | outputId, note }]
  next_plan    text NOT NULL DEFAULT '' CHECK (char_length(next_plan) <= 2000),
  done         boolean NOT NULL,       -- 팀장이 완료 조건을 다 채웠다고 본다 (완료는 주인의 최종 결재로만)
  milestone    boolean NOT NULL,       -- 중요한 단계라 주인에게 보이고 싶다 (checkpoint 'milestone')
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goal_rounds_once UNIQUE (run_id, round)
);
CREATE INDEX goal_rounds_task_idx ON task.goal_rounds (task_id);          -- 외래키
CREATE TRIGGER goal_rounds_append_only
  BEFORE UPDATE OR DELETE ON task.goal_rounds
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- migrate:down
DROP TABLE task.goal_rounds;
DROP TABLE task.goal_runs;
