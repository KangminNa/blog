-- migrate:up
-- 2차 4단계 모으기 (서브나 8장): 세션의 원문, 노트가 오기 전의 세션, 기기 권한 inbox.

-- 기기 권한 inbox: 기다리는 결재 · 질문만 읽는다 (브라우저 확장의 배지, MCP inbox).
-- 확장 기기(OAuth scope=extension)가 upload · delegate와 함께 가진다. 관리자도 기기 메뉴에서 줄 수 있다
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'sandbox', 'delegate', 'news', 'inbox']::text[]);

-- 세션의 원문 (추가만, 원칙 2): 수집 훅 · 확장이 올린 대화 원문(내 컴퓨터와 서버에서 민감정보를 지운 것).
-- 노트(session_revisions)는 서버 러너가 이 원문으로 쓴다. 같은 원문이 다시 오면 쌓지 않는다
CREATE TABLE vault.session_transcripts (
  id            uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  session_id    uuid NOT NULL REFERENCES vault.sessions(node_id) ON DELETE CASCADE,
  seq           int NOT NULL,
  text          text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000000),
  content_hash  text NOT NULL,
  redactions    jsonb,
  actor_type    text NOT NULL CHECK (actor_type IN ('device', 'system')),
  actor_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq),
  UNIQUE (session_id, content_hash)
);
CREATE TRIGGER session_transcripts_append_only
  BEFORE UPDATE OR DELETE ON vault.session_transcripts
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- 원문이 먼저 오는 세션은 노트(판)가 없는 채로 있다 (head_revision_id NULL, revision_count 0).
-- transcript_count: 쌓인 원문 수. noted_seq: 지금 노트를 쓴 원문의 번호 (늦게 온 옛 원문의 노트가 새 노트를 덮지 않게)
ALTER TABLE vault.sessions
  ADD COLUMN transcript_count int NOT NULL DEFAULT 0,
  ADD COLUMN noted_seq int NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE vault.sessions DROP COLUMN noted_seq, DROP COLUMN transcript_count;
DROP TABLE vault.session_transcripts;
UPDATE account.devices SET scopes = array_remove(scopes, 'inbox');
ALTER TABLE account.devices DROP CONSTRAINT devices_scopes_check;
ALTER TABLE account.devices ADD CONSTRAINT devices_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'run', 'sandbox', 'delegate', 'news']::text[]);
