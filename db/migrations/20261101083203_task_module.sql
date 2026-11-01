-- migrate:up
-- 작업과 결재 (3단계, 2026-11-01). 에이전트 · 작업(+ 실행 기록) · 결재를 task 스키마에 둔다.
--   대기열이 둘이 되지 않게, 쓰는 코드가 없는 platform.jobs를 없애고 task.tasks로 합친다.
--   기기 권한에 run(러너: next_jobs · report_progress · submit_result · release_job)을 더한다.
--   다른 모듈의 행(space_id, leased_by, decided_by, target_id)은 값으로만 가리킨다.

CREATE SCHEMA task;

CREATE TABLE task.agents (
  id                uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id          uuid NOT NULL,
  name              text NOT NULL,
  role              text NOT NULL DEFAULT '',
  tool              text NOT NULL CHECK (tool IN ('claude', 'codex')),
  -- 작업 토큰에 담기는 권한. run은 러너의 것이라 에이전트에게 줄 수 없다
  scopes            text[] NOT NULL DEFAULT '{}'
                    CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write']::text[]),
  approval_actions  text[] NOT NULL DEFAULT '{}',   -- 결재를 올려 할 수 있는 동작
  monthly_limit     bigint CHECK (monthly_limit > 0),   -- 한 달 토큰 한도. 비어 있으면 한도 없음
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  version           int NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_space_idx ON task.agents (space_id, id);   -- 에이전트 목록, 담당이 없는 일을 맡을 에이전트

CREATE TABLE task.tasks (
  id            uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id      uuid NOT NULL,
  agent_id      uuid REFERENCES task.agents(id),   -- 비어 있으면 빌릴 때 정한다
  kind          text NOT NULL,                     -- draft_post · tidy_session …
  title         text NOT NULL,
  instruction   text NOT NULL DEFAULT '',
  payload       jsonb NOT NULL DEFAULT '{}',
  result        jsonb,
  target_kind   text,
  target_id     uuid,
  base_version  int,
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'waiting', 'done', 'failed', 'cancelled')),
  priority      int NOT NULL DEFAULT 0,
  lease_until   timestamptz,
  leased_by     uuid,                              -- 러너 기기 (값)
  attempts      int NOT NULL DEFAULT 0,
  request_id    text,
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  UNIQUE (space_id, request_id)                    -- 같은 일 요청은 한 번만
);
CREATE INDEX tasks_queued_idx ON task.tasks (space_id, priority DESC, id) WHERE status = 'queued';   -- 일 빌리기 (SKIP LOCKED)
CREATE INDEX tasks_lease_idx ON task.tasks (lease_until) WHERE status = 'running';                  -- 끝난 임대 되돌리기
CREATE INDEX tasks_list_idx ON task.tasks (space_id, id DESC);                                      -- 작업 목록
CREATE INDEX tasks_agent_idx ON task.tasks (agent_id);                                              -- 외래키, 에이전트의 이번 달 사용량

-- 실행 기록. 보드·사용량이 같은 로그를 읽는다. 추가만 (원칙 2)
CREATE TABLE task.task_events (
  id       bigserial PRIMARY KEY,
  task_id  uuid NOT NULL REFERENCES task.tasks(id),
  at       timestamptz NOT NULL DEFAULT now(),
  kind     text NOT NULL CHECK (kind IN ('read', 'write', 'result', 'error')),
  body     text NOT NULL DEFAULT '',
  tokens   int NOT NULL DEFAULT 0 CHECK (tokens >= 0)
);
CREATE INDEX task_events_task_idx ON task.task_events (task_id, id);   -- 작업 하나의 기록, 사용량
CREATE TRIGGER task_events_append_only
  BEFORE UPDATE OR DELETE ON task.task_events
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

CREATE TABLE task.approvals (
  id              uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id        uuid NOT NULL,
  task_id         uuid REFERENCES task.tasks(id),    -- 한도 변경처럼 작업에 묶이지 않는 결재는 비어 있다
  agent_id        uuid REFERENCES task.agents(id),
  action          text NOT NULL,                     -- blog.post.publish · sns.post.send · task.agent.raise_limit
  target_kind     text NOT NULL,
  target_id       uuid NOT NULL,
  target_version  int NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'revision_requested', 'approved', 'rejected', 'cancelled')),
  decided_by      uuid,                              -- 주인 (값)
  decided_at      timestamptz,
  note            text,
  version         int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_list_idx ON task.approvals (space_id, id DESC);                                -- 결재 목록
CREATE INDEX approvals_pending_idx ON task.approvals (space_id, id DESC) WHERE status = 'pending';    -- 기다리는 결재
CREATE UNIQUE INDEX approvals_one_pending_idx ON task.approvals (task_id) WHERE status = 'pending';   -- 작업 하나에 기다리는 결재는 하나
CREATE INDEX approvals_task_idx ON task.approvals (task_id);                                          -- 외래키
CREATE INDEX approvals_agent_idx ON task.approvals (agent_id);                                        -- 외래키

DROP TABLE platform.jobs;

ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run']::text[]);

-- migrate:down
UPDATE account.devices SET scopes = array_remove(scopes, 'run') WHERE 'run' = ANY (scopes);
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write']::text[]);

CREATE TABLE platform.jobs (
  id            uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id      uuid NOT NULL,
  kind          text NOT NULL,
  target_kind   text,
  target_id     uuid,
  base_version  int,
  payload       jsonb NOT NULL DEFAULT '{}',
  result        jsonb,
  status        text NOT NULL DEFAULT 'ready'
                CHECK (status IN ('ready', 'leased', 'deferred', 'done', 'failed')),
  priority      int NOT NULL DEFAULT 0,
  lease_until   timestamptz,
  leased_by     uuid,
  attempts      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  done_at       timestamptz
);
CREATE INDEX jobs_ready_idx ON platform.jobs (space_id, priority DESC, created_at) WHERE status = 'ready';
CREATE INDEX jobs_lease_idx ON platform.jobs (lease_until) WHERE status = 'leased';
CREATE INDEX jobs_target_idx ON platform.jobs (target_kind, target_id) WHERE status IN ('ready', 'leased', 'deferred');
CREATE INDEX jobs_leased_by_idx ON platform.jobs (leased_by);

DROP SCHEMA task CASCADE;
