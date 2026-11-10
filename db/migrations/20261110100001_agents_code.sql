-- migrate:up
-- 코드 작업 (docs/코드작업.md 2단계): 에이전트 권한 code. 칸 안에서 셸로 저장소를 고친다.
-- 비공개 지식과 코드 작업은 섞지 않는다: 저장소 파일에 심은 지시문에 속아도 비공개 세션 · wiki나 임시 글 · 소재를
-- 저장소나 허용한 호스트로 내보내지 못하게, code는 read_all · write와 함께 줄 수 없다 (Agent의 규칙과 같다)
ALTER TABLE task.agents DROP CONSTRAINT agents_scopes_check;
ALTER TABLE task.agents ADD CONSTRAINT agents_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse', 'code']::text[]);
ALTER TABLE task.agents ADD CONSTRAINT agents_code_not_private
  CHECK (NOT ('code' = ANY (scopes) AND scopes && ARRAY['read_all', 'write']::text[]));

-- migrate:down
UPDATE task.agents SET scopes = array_remove(scopes, 'code'), version = version + 1 WHERE 'code' = ANY (scopes);
ALTER TABLE task.agents DROP CONSTRAINT agents_code_not_private;
ALTER TABLE task.agents DROP CONSTRAINT agents_scopes_check;
ALTER TABLE task.agents ADD CONSTRAINT agents_scopes_check
  CHECK (scopes <@ ARRAY['upload', 'read_public', 'read_all', 'tidy', 'write', 'browse']::text[]);
