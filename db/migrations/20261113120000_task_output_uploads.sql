-- migrate:up
-- 주인이 올린 파일도 결과물로 둔다: 만들기 일의 재료로 넘기려고 (기획서 결정 2026-11-13).
-- 작업이 만든 것이 아니라 task_id · run_id가 없다. 둘은 함께 있거나 함께 없다
ALTER TABLE task.outputs ALTER COLUMN task_id DROP NOT NULL, ALTER COLUMN run_id DROP NOT NULL;
ALTER TABLE task.outputs ADD CONSTRAINT outputs_origin CHECK ((task_id IS NULL) = (run_id IS NULL));

-- migrate:down
DELETE FROM task.outputs WHERE task_id IS NULL;
ALTER TABLE task.outputs DROP CONSTRAINT outputs_origin;
ALTER TABLE task.outputs ALTER COLUMN task_id SET NOT NULL, ALTER COLUMN run_id SET NOT NULL;
