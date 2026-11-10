-- migrate:up
-- 기능 패키지 code-github의 자기 스키마 (코드 작업 4단계, docs/코드작업.md 5장). 코어 표에 외래키를 걸지 않는다 (space_id · task_id는 값으로만)
CREATE SCHEMA code_github;

-- 주인이 등록한 저장소. 칸이 돌리는 명령(setup · checks)은 여기 적은 것만 쓴다 (저장소에 커밋된 명령은 쓰지 않는다).
-- 지우지 않고 보관한다(archived_at): 지난 PR 기록이 가리키기 때문이다
CREATE TABLE code_github.repos (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  -- https://<호스트>/<owner>/<이름>[.git]. 자격이 든 주소는 받지 않는다
  url text NOT NULL CHECK (url ~ '^https?://[^/@\s]+/[^/\s]+/[^/\s]+$' AND char_length(url) <= 300),
  base text NOT NULL CHECK (base ~ '^[A-Za-z0-9._/-]{1,100}$'),
  setup text NOT NULL DEFAULT '' CHECK (char_length(setup) <= 2000),
  checks text[] NOT NULL DEFAULT '{}' CHECK (cardinality(checks) <= 10),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
-- 콘솔 목록 (공간의 저장소). 같은 주소는 보관하지 않은 것 하나만
CREATE INDEX repos_space_idx ON code_github.repos (space_id, id DESC);
CREATE UNIQUE INDEX repos_url_once ON code_github.repos (space_id, url) WHERE archived_at IS NULL;

-- 러너가 연 PR. 작업 하나에 PR 하나 ("고쳐 달라"로 다시 돌면 같은 PR이 갱신된다).
-- version은 head가 바뀔 때마다 오른다: 결재(code.pr.merge)의 판이다. 승인한 판과 다르면 머지를 확인하지 않는다
CREATE TABLE code_github.pulls (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  repo_id uuid NOT NULL REFERENCES code_github.repos(id),
  task_id uuid NOT NULL,
  branch text NOT NULL CHECK (branch ~ '^cairn/[0-9a-f-]{36}$'),
  number integer NOT NULL CHECK (number > 0),
  url text NOT NULL CHECK (url ~ '^https?://' AND char_length(url) <= 500),
  head_sha text NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  checks jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(checks) = 'array'),   -- [{ command, ok }]
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'closed')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pulls_task_once UNIQUE (task_id),
  CONSTRAINT pulls_number_once UNIQUE (repo_id, number)
);
-- 콘솔 PR 목록 (공간의 PR, 최근 것부터)
CREATE INDEX pulls_space_idx ON code_github.pulls (space_id, id DESC);

-- migrate:down
DROP TABLE code_github.pulls;
DROP TABLE code_github.repos;
DROP SCHEMA code_github;
