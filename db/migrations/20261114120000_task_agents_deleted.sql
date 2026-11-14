-- migrate:up
-- 에이전트 삭제는 휴지통 방식 (기획서 결정 2026-11-14): 작업 · 결재 · 설정 판 · 스케줄 · 목표 실행이 에이전트를 가리켜서
-- 행을 지우지 않고 deleted_at을 적는다. 삭제한 에이전트는 목록 · 조직도에서 빠지고 새 일을 받지 않으며, 되돌릴 수 있다
ALTER TABLE task.agents ADD COLUMN deleted_at timestamptz;

-- migrate:down
ALTER TABLE task.agents DROP COLUMN deleted_at;
