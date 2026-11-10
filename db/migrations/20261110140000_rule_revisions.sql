-- migrate:up
-- 규칙 판 기록 (기획서 결정 2026-11-10): 결과가 바뀌었을 때 무엇을 바꿔서인지 추적한다.
--   에이전트 설정 판: 주인이 정하는 칸(이름 · 역할 글 · 도구 · 권한 · 결재 동작 · 한도 · 보고 대상)이 바뀔 때마다 판을 쌓는다.
--   실행 기록: 일을 빌려 줄 때마다 한 줄. 어떤 에이전트 설정 판 · 스킬 판 · 러너 빌드 · CLI로 돌았는지. 모델은 러너의 첫 보고로 채운다.
ALTER TABLE task.agents
  ADD COLUMN settings_revision int NOT NULL DEFAULT 1 CHECK (settings_revision > 0);   -- 지금 설정 판

CREATE TABLE task.agent_revisions (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  agent_id    uuid NOT NULL REFERENCES task.agents(id),
  revision    int NOT NULL CHECK (revision > 0),
  settings    jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),   -- 그 판의 설정 칸 전부
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_revisions_number UNIQUE (agent_id, revision)          -- 판 하나 · 판 목록
);
CREATE TRIGGER agent_revisions_append_only
  BEFORE UPDATE OR DELETE ON task.agent_revisions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- 지금 있는 에이전트는 지금 설정이 판 1이다
INSERT INTO task.agent_revisions (agent_id, revision, settings, created_at)
SELECT id, 1, jsonb_build_object(
    'name', name, 'role', role, 'tool', tool, 'scopes', to_jsonb(scopes),
    'approval_actions', to_jsonb(approval_actions), 'monthly_limit', monthly_limit,
    'five_hour_limit', five_hour_limit, 'plan_stop_percent', plan_stop_percent, 'reports_to', reports_to),
  created_at
FROM task.agents;

CREATE TABLE task.task_runs (
  id              uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id        uuid NOT NULL,
  task_id         uuid NOT NULL REFERENCES task.tasks(id),
  seq             int NOT NULL CHECK (seq > 0),                -- 이 작업의 몇 번째 실행 (attempts는 고쳐 달라 · 깨우기에서 0으로 돌아간다)
  runner_id       uuid NOT NULL,                               -- 빌려 간 러너 기기 (account 모듈의 id라 외래키 없음)
  agent_id        uuid REFERENCES task.agents(id),             -- 연결 확인 · 웹 로그인은 에이전트가 없다
  agent_revision  int CHECK (agent_revision > 0),
  skill           text,
  skill_source    text CHECK (skill_source IN ('repo', 'console')),
  skill_revision  int CHECK (skill_revision > 0),              -- 콘솔 판이면 그 번호
  skill_hash      text CHECK (skill_hash ~ '^[0-9a-f]{64}$'),
  runner_build    text CHECK (char_length(runner_build) <= 80),   -- 러너가 알린 빌드 (지시문 틀의 판)
  cli_version     text CHECK (char_length(cli_version) <= 80),
  model           text CHECK (char_length(model) <= 120),         -- 러너의 첫 보고가 채운다
  started_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_runs_seq UNIQUE (task_id, seq),                -- 작업 상세의 실행 목록
  CONSTRAINT task_runs_skill_whole CHECK ((skill IS NULL) = (skill_hash IS NULL))
);

-- 실행 기록은 고치지 않는다. model만, 비어 있을 때 한 번 채울 수 있다
CREATE FUNCTION task.task_runs_model_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.model IS NOT NULL OR (to_jsonb(NEW) - 'model') IS DISTINCT FROM (to_jsonb(OLD) - 'model') THEN
    RAISE EXCEPTION 'task.task_runs: 실행 기록은 비어 있는 model을 한 번 채우는 것 말고는 바꿀 수 없어요';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_runs_model_once
  BEFORE UPDATE ON task.task_runs
  FOR EACH ROW EXECUTE FUNCTION task.task_runs_model_once();
CREATE TRIGGER task_runs_no_delete
  BEFORE DELETE ON task.task_runs
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- migrate:down
DROP TABLE task.task_runs;
DROP FUNCTION task.task_runs_model_once();
DROP TABLE task.agent_revisions;
ALTER TABLE task.agents DROP COLUMN settings_revision;
