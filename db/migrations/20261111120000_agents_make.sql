-- migrate:up
-- 결과물 2차 (기획서 결정 2026-11-11): 에이전트 권한 make. 코드 러너 칸 안에서 셸로 PPT · 문서 · 영상을 만든다.
-- code와 같은 이유로 read_all · write와 함께 줄 수 없다: 셸이 있는 칸은 허용한 호스트로 나갈 수 있어서,
-- 재료에 심은 지시문에 속아도 주인이 고르지 않은 비공개 세션 · wiki나 임시 글 · 소재를 내보내지 못하게 (Agent의 규칙과 같다)
ALTER TABLE task.agents DROP CONSTRAINT agents_scopes_check;
ALTER TABLE task.agents ADD CONSTRAINT agents_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse', 'code', 'make']::text[]);
ALTER TABLE task.agents ADD CONSTRAINT agents_make_not_private
  CHECK (NOT ('make' = ANY (scopes) AND scopes && ARRAY['read_all', 'write']::text[]));

-- migrate:down
UPDATE task.agents SET scopes = array_remove(scopes, 'make'), version = version + 1 WHERE 'make' = ANY (scopes);
ALTER TABLE task.agents DROP CONSTRAINT agents_make_not_private;
ALTER TABLE task.agents DROP CONSTRAINT agents_scopes_check;
ALTER TABLE task.agents ADD CONSTRAINT agents_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse', 'code']::text[]);
