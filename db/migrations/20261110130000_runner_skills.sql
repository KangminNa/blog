-- migrate:up
-- 러너 스킬의 콘솔 판 (기획서 결정 2026-11-10). 저장소 skills/의 러너 전용 스킬(cairn-where: runner) 위에
-- 주인이 콘솔에서 고친 판을 얹는다. 판은 추가만 하고, 스킬마다 지금 쓰는 판(active_revision)을 가리킨다.
-- active_revision이 비어 있으면 저장소 판을 쓴다. 서버가 일을 빌려 줄 때 그 판의 파일을 러너에게 실어 보낸다.
CREATE TABLE task.skills (
  id               uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id         uuid NOT NULL,
  name             text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  active_revision  int CHECK (active_revision > 0),           -- 비어 있으면 저장소 판
  revisions        int NOT NULL DEFAULT 0 CHECK (revisions >= 0),   -- 마지막 판 번호
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skills_space_name UNIQUE (space_id, name),
  CONSTRAINT skills_active_exists CHECK (active_revision IS NULL OR active_revision <= revisions)
);

CREATE TABLE task.skill_revisions (
  id          uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  skill_id    uuid NOT NULL REFERENCES task.skills(id),
  revision    int NOT NULL CHECK (revision > 0),
  files       jsonb NOT NULL CHECK (jsonb_typeof(files) = 'object'),   -- { "SKILL.md": "…", "references/x.md": "…" }
  hash        text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),           -- 경로 · 내용으로 만든 sha256 (러너와 실행 기록이 같은 값을 쓴다)
  based_on    text NOT NULL CHECK (based_on ~ '^[0-9a-f]{64}$'),       -- 고칠 때 저장소 판의 해시 (저장소가 바뀌었는지 알리려고)
  note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_revisions_number UNIQUE (skill_id, revision)    -- 판 하나 읽기 · 판 목록
);
CREATE TRIGGER skill_revisions_append_only
  BEFORE UPDATE OR DELETE ON task.skill_revisions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

-- migrate:down
DROP TABLE task.skill_revisions;
DROP TABLE task.skills;
