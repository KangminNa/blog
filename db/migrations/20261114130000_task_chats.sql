-- migrate:up
-- 대화 (2026-11-14 사용자 결정): 관리자 바로 아래 에이전트와 채팅처럼 주고받는다.
--   서버 본체에는 AI가 없어서 메시지 하나 = 그 에이전트에게 맡긴 작업 하나다 (회차, 작업의 request_id 'chat:<대화>:<회차>').
--   관리자의 메시지는 작업의 지시, 답은 작업의 결과(result.text)라 이 표에는 대화의 머리(상대 · 제목 · 회차 수)만 둔다.
--   앞 대화는 회차 작업의 payload.chat.history에 자료로 싣는다 (러너가 "이전 대화"로 그린다).
CREATE TABLE task.chats (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id    uuid NOT NULL,
  agent_id    uuid NOT NULL REFERENCES task.agents(id),          -- 상대 (관리자 바로 아래 에이전트)
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),   -- 첫 메시지의 첫 줄
  turns       int NOT NULL DEFAULT 0 CHECK (turns >= 0),          -- 보낸 메시지 수 (= 마지막 회차)
  request_id  text NOT NULL,
  version     int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),                 -- 마지막으로 보낸 때 (목록 순서)
  CONSTRAINT chats_request UNIQUE (space_id, request_id)
);
CREATE INDEX chats_space_idx ON task.chats (space_id, updated_at DESC);   -- 대화 목록
CREATE INDEX chats_agent_idx ON task.chats (agent_id);                    -- 외래키

-- migrate:down
DROP TABLE task.chats;
