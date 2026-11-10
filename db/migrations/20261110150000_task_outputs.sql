-- migrate:up
-- 결과물 (기획서 결정 2026-11-10): AI가 만든 파일을 러너가 일이 끝난 뒤 올려 두는 곳.
-- 파일은 platform.blobs에 있고(내용 주소, 값으로만 가리킨다), 이 표는 어느 작업 · 실행이 만들었는지와 이름 · 종류를 든다.
-- 주인이 지우면 휴지통(30일) 뒤 일꾼이 줄을 지우고, 아무도 쓰지 않게 된 파일은 platform의 BlobSweepJob이 지운다.
CREATE TABLE task.outputs (
  id           uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id     uuid NOT NULL,
  task_id      uuid NOT NULL REFERENCES task.tasks(id),
  run_id       uuid NOT NULL REFERENCES task.task_runs(id),     -- 어느 실행이 만들었나 (규칙 판과 이어진다)
  name         text NOT NULL CHECK (
                 char_length(name) BETWEEN 1 AND 120
                 AND name !~ '[/\\[:cntrl:]]'
                 AND left(name, 1) <> '.'),
  kind         text NOT NULL CHECK (kind IN ('document', 'slides', 'sheet', 'image', 'video', 'other')),
  mime         text NOT NULL CHECK (char_length(mime) BETWEEN 1 AND 120),
  size_bytes   bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),   -- 파일 하나 100MB
  blob_hash    text NOT NULL CHECK (blob_hash ~ '^[0-9a-f]{64}$'),
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  purge_after  timestamptz,
  CONSTRAINT outputs_run_name UNIQUE (run_id, name),              -- 같은 실행이 같은 이름을 다시 올리면 같은 줄
  CONSTRAINT outputs_trash CHECK ((deleted_at IS NULL) = (purge_after IS NULL))
);
-- 결과물 메뉴: 최근부터, 지우지 않은 것
CREATE INDEX outputs_list ON task.outputs (space_id, id DESC) WHERE deleted_at IS NULL;
-- 작업 상세의 결과물 칸 (실행마다 개수 · 크기는 outputs_run_name으로 센다)
CREATE INDEX outputs_task ON task.outputs (task_id);
-- 휴지통 비우기 일꾼
CREATE INDEX outputs_purge ON task.outputs (purge_after) WHERE purge_after IS NOT NULL;

-- migrate:down
DROP TABLE task.outputs;
