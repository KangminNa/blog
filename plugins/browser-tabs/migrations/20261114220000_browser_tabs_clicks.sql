-- migrate:up
-- 2차 3단계 서버 브라우저 목표 (2026-11-14): 로그인 필요 표시, 결재된 클릭, 단계 화면. 코어 표는 바꾸지 않는다 (값으로만 가리킨다)

-- 로그인 화면을 만난 때. 관리자가 "로그인했어요"(로그인 결재의 수정 요청)를 누르면 비운다.
-- 판(version)은 올리지 않는다: 러너가 적는 표시가 관리자의 사이트 편집과 부딪히지 않게
ALTER TABLE browser_tabs.sites ADD COLUMN login_needed_at timestamptz;

-- 결재된 클릭 하나. AI가 마지막 버튼 앞에서 멈추면 러너(AI 없음)가 버튼을 다시 찾아 지문 · 화면과 함께 붙잡고(held),
-- 결재가 승인되면(approved) 붙잡은 러너만 같은 탭 · 주소 · 지문인지 다시 보고 누른다(clicking → clicked).
-- 다르면 누르지 않는다(changed). 누르는 중에 러너가 사라지면 다시 누르지 않는다(unknown). 결재가 닫히면 dropped,
-- 관리자가 콘솔 화면에서 직접 했거나 그만두면 manual
CREATE TABLE browser_tabs.clicks (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  task_id uuid NOT NULL,
  site_id uuid NOT NULL,
  runner_id uuid NOT NULL,
  tab_id text NOT NULL CHECK (tab_id ~ '^[A-Za-z0-9]{1,64}$'),
  page_url text NOT NULL CHECK (page_url ~ '^https?://' AND char_length(page_url) <= 2000),
  page_title text NOT NULL DEFAULT '' CHECK (char_length(page_title) <= 300),
  role text NOT NULL CHECK (role ~ '^[a-z]{1,40}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  nth integer NOT NULL DEFAULT 0 CHECK (nth BETWEEN 0 AND 50),
  box jsonb NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  note text CHECK (char_length(note) <= 500),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'approved', 'clicking', 'clicked', 'changed', 'unknown', 'dropped', 'manual')),
  approval_id uuid,
  reason text CHECK (char_length(reason) <= 500),
  after_url text CHECK (char_length(after_url) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  clicked_at timestamptz,
  version integer NOT NULL DEFAULT 1
);
-- 작업 하나에 열린 클릭은 하나뿐
CREATE UNIQUE INDEX clicks_open_idx ON browser_tabs.clicks (task_id)
  WHERE status IN ('held', 'approved', 'clicking');
-- 콘솔 목록 (공간의 클릭, 최근 것부터)
CREATE INDEX clicks_space_idx ON browser_tabs.clicks (space_id, id DESC);
-- 러너의 클릭 고리: 이 러너가 누를 차례인 것
CREATE INDEX clicks_runner_idx ON browser_tabs.clicks (runner_id, id)
  WHERE status IN ('approved', 'clicking');

-- 화면 하나 (JPEG · PNG, 300KB까지). 단계(step)는 AI가 단계마다 찍은 것을 러너가 올리고 작업마다 30장 · 30일까지.
-- 로그인 화면(login) · 멈춘 화면(before) · 누른 뒤(after) · 바뀐 화면(changed)은 러너가 직접 찍어 남긴다
CREATE TABLE browser_tabs.shots (
  id uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id uuid NOT NULL,
  task_id uuid NOT NULL,
  click_id uuid REFERENCES browser_tabs.clicks (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('step', 'login', 'before', 'after', 'changed')),
  seq integer NOT NULL CHECK (seq >= 1),
  url text NOT NULL DEFAULT '' CHECK (char_length(url) <= 2000),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 300),
  image bytea NOT NULL CHECK (octet_length(image) BETWEEN 1 AND 307200),
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, seq)
);
-- 30일이 지난 단계 화면 지우기
CREATE INDEX shots_step_age_idx ON browser_tabs.shots (space_id, created_at) WHERE kind = 'step';
CREATE INDEX shots_click_idx ON browser_tabs.shots (click_id) WHERE click_id IS NOT NULL;

-- migrate:down
DROP TABLE browser_tabs.shots;
DROP TABLE browser_tabs.clicks;
ALTER TABLE browser_tabs.sites DROP COLUMN login_needed_at;
