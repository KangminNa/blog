-- migrate:up
-- 실행 기록에 지시문 틀(러너 스킬 cairn-runner)의 판을 남긴다 (2차 1-0, 기획서 결정 2026-11-14).
-- 지시문의 글이 러너 코드에서 스킬로 옮겨 가서 runner_build만으로는 어떤 글로 돌았는지 알 수 없다. 옛 실행은 비어 있다
ALTER TABLE task.task_runs
  ADD COLUMN prompt_source   text CHECK (prompt_source IN ('repo', 'console')),
  ADD COLUMN prompt_revision int CHECK (prompt_revision > 0),
  ADD COLUMN prompt_hash     text CHECK (prompt_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT task_runs_prompt_whole CHECK ((prompt_source IS NULL) = (prompt_hash IS NULL));

-- migrate:down
ALTER TABLE task.task_runs
  DROP CONSTRAINT task_runs_prompt_whole,
  DROP COLUMN prompt_hash,
  DROP COLUMN prompt_revision,
  DROP COLUMN prompt_source;
