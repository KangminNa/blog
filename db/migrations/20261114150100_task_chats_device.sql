-- migrate:up
-- 기기가 연 대화 (MCP ask_agent, 2026-11-14): 그 기기만 이어 보내고 답을 읽는다 (agent_reply). null이면 관리자가 콘솔에서 연 대화.
-- 기기는 account의 것이라 값으로만 가리킨다 (모듈 사이 외래키 없음)
ALTER TABLE task.chats ADD COLUMN device_id uuid;

-- migrate:down
ALTER TABLE task.chats DROP COLUMN device_id;
