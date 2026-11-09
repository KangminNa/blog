-- migrate:up
-- 브라우저 에이전트는 글 · 소재도 읽지 않는다 (2026-11-09): write는 임시 글 본문과 소재 메모를 연다 (blog_get_post · basket_get).
-- 웹 페이지의 프롬프트 주입으로 읽은 것을 브라우저로 내보내지 못하게, browse는 read_all · write와 함께 줄 수 없다 (Agent의 규칙과 같다).
-- 이미 둘을 함께 가진 에이전트는 write를 뺀다: 브라우저 작업의 재료는 이제 지시문으로 받는다
UPDATE task.agents SET scopes = array_remove(scopes, 'write'), version = version + 1
  WHERE scopes @> ARRAY['browse', 'write']::text[];
ALTER TABLE task.agents DROP CONSTRAINT agents_browse_not_private;
ALTER TABLE task.agents ADD CONSTRAINT agents_browse_not_private
  CHECK (NOT ('browse' = ANY (scopes) AND scopes && ARRAY['read_all', 'write']::text[]));

-- migrate:down
-- 뺀 write는 되돌리지 않는다 (어느 에이전트였는지 남기지 않았다). 제약만 앞 모양으로
ALTER TABLE task.agents DROP CONSTRAINT agents_browse_not_private;
ALTER TABLE task.agents ADD CONSTRAINT agents_browse_not_private
  CHECK (NOT (scopes @> ARRAY['browse', 'read_all']::text[]));
