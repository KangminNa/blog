-- migrate:up
-- 결과 결재 (2차 2단계, 기획서 결정 2026-11-14): 대화 한 회차의 결재는 결과 카드 하나로 받는다.
--   approvals.chat_id: 대화의 일에서 올라온 도중 결재 (사람에게 따로 알리지 않고 카드에 모인다. 즉시 알릴 동작은 비운다)
--   approvals.card_id: 그 결재가 실린 카드 (카드도 approvals의 한 줄: 동작 task.chat.result, 대상 chat)
--   outputs.card_id: 카드에 실린 결과물 (한 번 실린 결과물은 다음 카드에 다시 실리지 않는다)
--   chats.deliver: 받을 것 (비우면 대화 답). 카드 전에 검사한다
--   agents.reviewer_id: 검토자 짝 (다른 AI 도구의 에이전트). 회차가 끝나면 카드 전에 검토 작업이 돈다
ALTER TABLE task.approvals
  ADD COLUMN chat_id uuid REFERENCES task.chats(id),
  ADD COLUMN card_id uuid REFERENCES task.approvals(id);
CREATE INDEX approvals_card ON task.approvals (card_id) WHERE card_id IS NOT NULL;
CREATE INDEX approvals_chat_pending ON task.approvals (chat_id) WHERE chat_id IS NOT NULL AND status = 'pending';
-- 대화마다 기다리는 카드는 하나 (새로 실릴 것은 그 카드에 더한다)
CREATE UNIQUE INDEX approvals_one_card ON task.approvals (target_id)
  WHERE action = 'task.chat.result' AND status = 'pending';

ALTER TABLE task.outputs ADD COLUMN card_id uuid REFERENCES task.approvals(id);
CREATE INDEX outputs_card ON task.outputs (card_id) WHERE card_id IS NOT NULL;

ALTER TABLE task.chats ADD COLUMN deliver text CHECK (deliver IN ('html', 'blog', 'browser', 'code'));

ALTER TABLE task.agents ADD COLUMN reviewer_id uuid REFERENCES task.agents(id);
ALTER TABLE task.agents ADD CONSTRAINT agents_reviewer_other CHECK (reviewer_id IS NULL OR reviewer_id <> id);

-- 소식에 검토 의견(review)을 더한다
ALTER TABLE task.chat_updates DROP CONSTRAINT chat_updates_kind_check;
ALTER TABLE task.chat_updates ADD CONSTRAINT chat_updates_kind_check CHECK (kind IN ('member_done', 'member_failed',
  'progress', 'decision', 'assumption', 'appended', 'reply', 'final', 'failed', 'review'));

-- migrate:down
ALTER TABLE task.chat_updates DROP CONSTRAINT chat_updates_kind_check;
ALTER TABLE task.chat_updates ADD CONSTRAINT chat_updates_kind_check CHECK (kind IN ('member_done', 'member_failed',
  'progress', 'decision', 'assumption', 'appended', 'reply', 'final', 'failed'));
ALTER TABLE task.agents DROP CONSTRAINT agents_reviewer_other;
ALTER TABLE task.agents DROP COLUMN reviewer_id;
ALTER TABLE task.chats DROP COLUMN deliver;
DROP INDEX task.outputs_card;
ALTER TABLE task.outputs DROP COLUMN card_id;
DROP INDEX task.approvals_one_card;
DROP INDEX task.approvals_chat_pending;
DROP INDEX task.approvals_card;
ALTER TABLE task.approvals DROP COLUMN card_id, DROP COLUMN chat_id;
