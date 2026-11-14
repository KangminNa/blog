-- migrate:up
-- 에이전트를 러너에 묶기 (2026-11-14 사용자 결정): 내 파일 · 로그인이 필요한 일은 내 컴퓨터 러너, 조사 · 만들기는 서버.
--   묶인 에이전트의 일은 그 러너만 빌린다. 러너가 꺼져 있으면 기다린다 (다른 러너가 대신하지 않는다).
--   코드 러너 칸에는 묶지 않고, 칸에서만 도는 권한(code · make)이 있는 에이전트는 묶지 않는다 (묶인 러너가 그 일을 받지 못한다).
ALTER TABLE task.runners ADD COLUMN sandbox boolean NOT NULL DEFAULT false;   -- 코드 러너 칸인가 (기기의 권한 sandbox로 서버가 닿을 때마다 적는다)
ALTER TABLE task.agents ADD COLUMN runner_id uuid REFERENCES task.runners(id); -- 이 러너만 일을 빌린다 (null: 아무 러너)
ALTER TABLE task.agents ADD CONSTRAINT agents_pinned_not_sandboxed
  CHECK (runner_id IS NULL OR NOT (scopes && ARRAY['code', 'make']::text[]));
CREATE INDEX agents_runner_idx ON task.agents (runner_id) WHERE runner_id IS NOT NULL;   -- 외래키

-- migrate:down
DROP INDEX task.agents_runner_idx;
ALTER TABLE task.agents DROP CONSTRAINT agents_pinned_not_sandboxed;
ALTER TABLE task.agents DROP COLUMN runner_id;
ALTER TABLE task.runners DROP COLUMN sandbox;
