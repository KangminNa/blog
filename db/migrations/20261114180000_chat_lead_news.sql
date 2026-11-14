-- migrate:up
-- 2차 1-1 대표 단일 창구 (기획서 결정 2026-11-14, docs/서브나.md 4장).
-- ① 기본 대표: 상대를 정하지 않고 맡기면(MCP ask_agent) 이 에이전트가 받는다. 공간에 하나, 관리자 바로 아래만
ALTER TABLE task.agents ADD COLUMN lead boolean NOT NULL DEFAULT false;
ALTER TABLE task.agents ADD CONSTRAINT agents_lead_top CHECK (NOT lead OR reports_to IS NULL);
CREATE UNIQUE INDEX agents_one_lead ON task.agents (space_id) WHERE lead AND deleted_at IS NULL;

-- ② 대화의 목표 한 줄과 프로젝트(git 주소를 github.com/<owner>/<repo> 모양으로 맞춘 값). 새 대화를 열 때만 정한다
ALTER TABLE task.chats
  ADD COLUMN goal    text CHECK (char_length(goal) <= 300),
  ADD COLUMN project text CHECK (char_length(project) <= 200);
CREATE INDEX chats_project ON task.chats (space_id, project) WHERE project IS NOT NULL;   -- 훅이 프로젝트로 거른다

-- ③ 대화의 소식 (추가만). 팀원 끝남 · 실패, 중간 보고 · 정한 것 · 가정, 덧붙인 말과 그 답, 최종 답.
-- n은 "여기부터 줘"의 커서다. 동시에 쓰는 트랜잭션이 커밋 순서를 바꿀 수 있어서, 읽는 쪽은 아직 끝나지 않은
-- 트랜잭션보다 앞선 줄(tx < pg_snapshot_xmin)만 읽는다: 늦게 커밋된 작은 n을 건너뛰지 않게
CREATE TABLE task.chat_updates (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  n           bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  tx          xid8 NOT NULL DEFAULT pg_current_xact_id(),
  space_id    uuid NOT NULL,
  chat_id     uuid NOT NULL REFERENCES task.chats(id),
  kind        text NOT NULL CHECK (kind IN ('member_done', 'member_failed', 'progress', 'decision',
                'assumption', 'appended', 'reply', 'final', 'failed')),
  task_id     uuid REFERENCES task.tasks(id),       -- 어느 작업의 소식인가 (덧붙인 말은 그 회차 작업)
  agent_id    uuid REFERENCES task.agents(id),      -- 누가 (덧붙인 말 · 최종 답은 비거나 대표)
  text        text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_updates_space_n ON task.chat_updates (space_id, n);   -- agent_updates: 공간의 n 다음부터
CREATE INDEX chat_updates_chat_n ON task.chat_updates (chat_id, n);     -- 대화 상세 · 대화로 거르기
CREATE INDEX chat_updates_task ON task.chat_updates (task_id, kind);    -- 작업마다 한도 · 덧붙인 말 읽기
CREATE TRIGGER chat_updates_append_only
  BEFORE UPDATE OR DELETE ON task.chat_updates
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- migrate:down
DROP TABLE task.chat_updates;
DROP INDEX task.chats_project;
ALTER TABLE task.chats DROP COLUMN project, DROP COLUMN goal;
DROP INDEX task.agents_one_lead;
ALTER TABLE task.agents DROP CONSTRAINT agents_lead_top;
ALTER TABLE task.agents DROP COLUMN lead;
