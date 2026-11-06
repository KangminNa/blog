-- migrate:up
-- 에이전트 조직 2: 위임 (2026-11-06).
--   팀장 에이전트가 delegate_task로 바로 아래 팀에게 하위 작업을 맡긴다. 하위 작업은 위 작업을 parent_id로 가리킨다.
--   위 작업은 하위 작업을 기다리는 waiting이 되고(wait_reason), 하위 작업이 모두 끝나면 대기열로 돌아간다.
--   새 상태는 만들지 않는다: waiting에 무엇을 기다리는지만 적는다. 깊이·라운드 한도는 DB도 막는다.

ALTER TABLE task.tasks
  ADD COLUMN parent_id uuid REFERENCES task.tasks(id),
  ADD COLUMN depth int NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 3),        -- 위임 깊이. 주인이 맡긴 작업이 0
  ADD COLUMN wait_reason text CHECK (wait_reason IN ('approval', 'subtasks')),
  ADD COLUMN rounds int NOT NULL DEFAULT 0 CHECK (rounds BETWEEN 0 AND 3);      -- 이 작업이 위임한 횟수

-- 지금 기다리는 작업은 모두 결재를 기다린다
UPDATE task.tasks SET wait_reason = 'approval' WHERE status = 'waiting';
ALTER TABLE task.tasks ADD CONSTRAINT tasks_waiting_reason_check
  CHECK ((status = 'waiting') = (wait_reason IS NOT NULL));

CREATE INDEX tasks_parent_idx ON task.tasks (parent_id, id) WHERE parent_id IS NOT NULL;   -- 하위 작업, 외래키

-- migrate:down
DROP INDEX task.tasks_parent_idx;
ALTER TABLE task.tasks
  DROP CONSTRAINT tasks_waiting_reason_check,
  DROP COLUMN rounds,
  DROP COLUMN wait_reason,
  DROP COLUMN depth,
  DROP COLUMN parent_id;
