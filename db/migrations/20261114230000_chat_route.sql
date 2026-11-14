-- migrate:up
-- 2차 1-5 대화 중심 (기획서 결정 2026-11-14): 보내면 "맡는 일"이 맞는 에이전트가 맡는다 (배정). 애매하면 대화로 묻는다.
-- 맡기 전의 대화는 상대가 없고(agent_id NULL) 받은 말(첫 메시지와 질문에 글로 한 답)을 pending에 모은다.
-- 맡으면 그 말로 첫 회차를 열고 pending을 비운다
ALTER TABLE task.chats ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE task.chats ADD COLUMN pending text;
ALTER TABLE task.chats ADD CONSTRAINT chats_pending CHECK ((agent_id IS NULL) = (pending IS NOT NULL));

-- 질문(question)은 고를 에이전트(choices)를 함께 남기고, 맡음(routed)은 맡은 에이전트(agent_id)를 남긴다
ALTER TABLE task.chat_updates ADD COLUMN choices uuid[];
ALTER TABLE task.chat_updates ADD CONSTRAINT chat_updates_choices CHECK (choices IS NULL OR kind = 'question');
ALTER TABLE task.chat_updates DROP CONSTRAINT chat_updates_kind_check;
ALTER TABLE task.chat_updates ADD CONSTRAINT chat_updates_kind_check CHECK (kind IN ('member_done', 'member_failed',
  'progress', 'decision', 'assumption', 'appended', 'reply', 'final', 'failed', 'review', 'question', 'routed'));

-- 기본 대표는 없앤다: 배정이 대신한다
DROP INDEX task.agents_one_lead;
ALTER TABLE task.agents DROP CONSTRAINT agents_lead_top;
ALTER TABLE task.agents DROP COLUMN lead;

-- migrate:down
ALTER TABLE task.agents ADD COLUMN lead boolean NOT NULL DEFAULT false;
ALTER TABLE task.agents ADD CONSTRAINT agents_lead_top CHECK (NOT lead OR reports_to IS NULL);
CREATE UNIQUE INDEX agents_one_lead ON task.agents (space_id) WHERE lead AND deleted_at IS NULL;

-- 소식은 추가만이라(트리거) 되돌릴 때만 잠시 끈다
ALTER TABLE task.chat_updates DISABLE TRIGGER chat_updates_append_only;
DELETE FROM task.chat_updates WHERE kind IN ('question', 'routed')
  OR chat_id IN (SELECT id FROM task.chats WHERE agent_id IS NULL);
ALTER TABLE task.chat_updates ENABLE TRIGGER chat_updates_append_only;
ALTER TABLE task.chat_updates DROP CONSTRAINT chat_updates_kind_check;
ALTER TABLE task.chat_updates ADD CONSTRAINT chat_updates_kind_check CHECK (kind IN ('member_done', 'member_failed',
  'progress', 'decision', 'assumption', 'appended', 'reply', 'final', 'failed', 'review'));
ALTER TABLE task.chat_updates DROP CONSTRAINT chat_updates_choices;
ALTER TABLE task.chat_updates DROP COLUMN choices;

-- 맡기 전의 대화는 되돌릴 자리가 없어 지운다 (그 소식은 위에서 지웠다)
DELETE FROM task.chats WHERE agent_id IS NULL;
ALTER TABLE task.chats DROP CONSTRAINT chats_pending;
ALTER TABLE task.chats DROP COLUMN pending;
ALTER TABLE task.chats ALTER COLUMN agent_id SET NOT NULL;
