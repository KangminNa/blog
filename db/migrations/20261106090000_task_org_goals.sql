-- migrate:up
-- 에이전트 조직 1: 조직도와 목표 (2026-11-06).
--   에이전트마다 보고 대상을 둔다. 비어 있으면 주인에게 보고한다. 순환과 깊이 4는 Agent가 막는다.
--   목표는 나무다. 맨 위가 회사 목표이고, 작업은 목표 하나에 이어질 수 있다.
--   목표는 지우지 않고 상태(끝남 · 그만둠)로 닫는다 (들어온 정보는 버리지 않는다).

ALTER TABLE task.agents
  ADD COLUMN reports_to uuid REFERENCES task.agents(id),
  ADD CONSTRAINT agents_reports_to_self CHECK (reports_to <> id);
CREATE INDEX agents_reports_to_idx ON task.agents (reports_to);   -- 외래키, 바로 아래 팀

CREATE TABLE task.goals (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  parent_id    uuid REFERENCES task.goals(id),   -- 비어 있으면 맨 위 (회사 목표)
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'dropped')),
  sort         int NOT NULL DEFAULT 0,           -- 같은 부모 안의 순서
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goals_parent_self CHECK (parent_id <> id)
);
CREATE INDEX goals_space_idx ON task.goals (space_id, sort, id);   -- 목표 나무
CREATE INDEX goals_parent_idx ON task.goals (parent_id);           -- 외래키

ALTER TABLE task.tasks ADD COLUMN goal_id uuid REFERENCES task.goals(id);
CREATE INDEX tasks_goal_idx ON task.tasks (goal_id, id DESC) WHERE goal_id IS NOT NULL;   -- 목표별 작업, 외래키

-- migrate:down
DROP INDEX task.tasks_goal_idx;
ALTER TABLE task.tasks DROP COLUMN goal_id;
DROP TABLE task.goals;
DROP INDEX task.agents_reports_to_idx;
ALTER TABLE task.agents
  DROP CONSTRAINT agents_reports_to_self,
  DROP COLUMN reports_to;
