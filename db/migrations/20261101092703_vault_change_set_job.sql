-- migrate:up
-- 작업 하나에 정리 결과는 묶음 하나 (6단계, 2026-11-01). 러너가 submit_changes와 submit_result 사이에 죽어
-- 같은 작업을 다시 해도, 작업 토큰의 두 번째 제출은 첫 묶음을 돌려주고 두 번 적용하지 않는다.
-- job_id는 task.tasks의 id를 값으로만 담는다 (모듈 사이 외래키 없음). 기기의 제출은 비어 있고 request_id가 중복을 막는다.
-- wiki 키워드 찾기는 인덱스가 이미 있다 (wikis_title_bigm, wikis_text_bigm).
DROP INDEX vault.change_sets_job;
CREATE UNIQUE INDEX change_sets_job ON vault.change_sets (job_id) WHERE job_id IS NOT NULL;

-- migrate:down
DROP INDEX vault.change_sets_job;
CREATE INDEX change_sets_job ON vault.change_sets (job_id) WHERE job_id IS NOT NULL;
