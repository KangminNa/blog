-- migrate:up
-- 러너의 상태와 일 받기 켜기·끄기 (2026-11-06). 러너(run 권한 기기)가 서버에 닿을 때마다 한 줄을 만들거나 고친다.
--   기기의 이름·종류는 account가 가진다: 여기서는 기기 id를 값으로만 갖고, 화면이 기기 목록과 합쳐 보인다.
--   일 받기를 끄면 next_jobs가 빈 목록을 돌려준다. 러너 프로세스는 켜진 채로 쉰다 (웹이 컨테이너를 켜고 끄지 않는다).

CREATE TABLE task.runners (
  id            uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id      uuid NOT NULL,
  device_id     uuid NOT NULL UNIQUE,              -- 러너 기기 (account, 값으로만)
  accepting     boolean NOT NULL DEFAULT true,     -- 일 받기
  last_seen_at  timestamptz NOT NULL DEFAULT now(), -- 마지막으로 서버에 닿은 때 (next_jobs · report_progress). version을 올리지 않는다
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runners_space_idx ON task.runners (space_id, id);   -- 러너 목록

-- migrate:down
DROP TABLE task.runners;
