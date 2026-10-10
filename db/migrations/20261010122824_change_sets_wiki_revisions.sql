-- migrate:up
-- 변경 묶음과 검토 규칙, wiki 판 (2026-10-10 결정)
--   git처럼: AI가 결과를 한 번 낼 때마다 변경 묶음(커밋) 하나. 서버가 변경마다 검토 규칙을 대 보고
--   바로 합치기 / 검토(승인함) / 거부를 정한다. 대정리는 작성 중인 묶음(브랜치), 되돌리기는 새 묶음(revert).
--   관리 화면에서 고친 것도 묶음(kind = human)으로 남겨 기록·되돌리기를 한 길로 쓴다.
--   승인함은 proposals 대신 change_ops 중 검토를 기다리는 것이다.
--   wiki도 세션처럼 판을 쌓는다. 칸은 md 제목(##) 단위이고, 사람이 고친 칸은 AI가 바로 바꾸지 못한다.

-- 변경 묶음 (커밋 · PR · 브랜치) ---------------------------------------------------------
CREATE TABLE vault.change_sets (
  id                  uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id            uuid NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('tidy', 'reorg', 'human', 'revert', 'system')),
  status              text NOT NULL CHECK (status IN ('open', 'review', 'done')),
  -- open: 대정리 작성 중(아직 아무것도 적용 안 됨) · review: 검토를 기다리는 변경이 있음 · done: 모두 처리됨
  actor_type          text NOT NULL CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id            uuid,
  job_id              uuid,                                  -- platform.jobs (값)
  message             text NOT NULL DEFAULT '',              -- 왜 바꾸는지 (AI가 적는 설명)
  base_graph_version  bigint,                                -- 대정리가 갈라진 기준점
  op_count            int NOT NULL DEFAULT 0,
  reverted_by         uuid REFERENCES vault.change_sets(id),  -- 이 묶음을 되돌린 묶음
  version             int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  closed_at           timestamptz
);
CREATE INDEX change_sets_history  ON vault.change_sets (space_id, created_at DESC);                  -- 변경 기록 화면
CREATE INDEX change_sets_review   ON vault.change_sets (space_id, submitted_at) WHERE status = 'review';  -- 승인함
CREATE INDEX change_sets_by_actor ON vault.change_sets (actor_id, created_at);                       -- "이 기기가 이때부터 한 일" 되돌리기
CREATE INDEX change_sets_job      ON vault.change_sets (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX change_sets_reverted ON vault.change_sets (reverted_by) WHERE reverted_by IS NOT NULL;
-- 대정리는 한 번에 하나
CREATE UNIQUE INDEX change_sets_one_reorg ON vault.change_sets (space_id)
  WHERE kind = 'reorg' AND status IN ('open', 'review');

-- 묶음 안의 변경 하나 ----------------------------------------------------------------------
-- 요청한 일(예: wiki A와 B 합치기)이다. 그 결과 실제로 바뀐 행의 전/후는 vault.changes(batch_id = change_set_id)에.
CREATE TABLE vault.change_ops (
  change_set_id  uuid NOT NULL REFERENCES vault.change_sets(id) ON DELETE CASCADE,
  seq            int NOT NULL,
  op             text NOT NULL,                              -- wiki.revise · session.assign · category.merge … (목록은 서버의 ChangeOp)
  target_kind    text NOT NULL CHECK (target_kind IN ('session', 'wiki', 'category', 'edge')),
  target_id      uuid,                                       -- 새로 만드는 변경은 적용할 때 채운다
  base_version   int,                                        -- AI가 보고 고친 대상의 version
  payload        jsonb NOT NULL DEFAULT '{}',
  verdict        text CHECK (verdict IN ('merge', 'review', 'reject')),   -- 비어 있으면 아직 판정 전 (대정리 작성 중)
  rule           text,                                       -- 걸린 규칙 (review_rules.key)
  status         text NOT NULL CHECK (status IN (
                   'pending',      -- 판정 전
                   'applied',      -- 적용됨 (바로 합쳐졌거나, 승인 뒤 적용)
                   'waiting',      -- 검토 기다림 (승인함)
                   'approved',     -- 승인됨, 일꾼이 적용할 차례 (대정리)
                   'declined',     -- 사람이 거절
                   'rejected',     -- 규칙이 거부했거나 대상이 없음
                   'superseded')), -- 기다리는 사이 대상이 바뀌어 밀려남
  reason         text,
  decided_at     timestamptz,
  decided_by     uuid,
  PRIMARY KEY (change_set_id, seq)
);
-- 대상이 바뀌면 그 대상을 기다리던 검토 항목을 밀려남으로 바꾼다
CREATE INDEX change_ops_waiting_target ON vault.change_ops (target_id) WHERE status = 'waiting';

-- 검토 규칙 설정 (보호 브랜치 설정) --------------------------------------------------------
-- 규칙의 목록과 뜻은 서버 코드(ReviewRule 하위 클래스)에 있고, 여기에는 주인이 고른 값만 둔다. 행이 없으면 기본값.
CREATE TABLE vault.review_rules (
  space_id    uuid NOT NULL,
  key         text NOT NULL,                                 -- add · edit_own · human_owned · structure · publish · delete · large_set
  action      text NOT NULL CHECK (action IN ('merge', 'review', 'reject')),
  value       int,                                           -- 규칙이 쓰는 숫자 (large_set: 대상 개수)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  PRIMARY KEY (space_id, key)
);

-- 승인함은 change_ops로 옮긴다 ------------------------------------------------------------
DROP TABLE vault.proposals;

-- wiki 판 (추가만) ------------------------------------------------------------------------
CREATE TABLE vault.wiki_revisions (
  id                uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  wiki_id           uuid NOT NULL REFERENCES vault.wikis(node_id) ON DELETE CASCADE,
  seq               int NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('ai', 'human', 'merge')),
  base_revision_id  uuid REFERENCES vault.wiki_revisions(id),   -- 이 판을 쓸 때 보고 있던 판 (칸 단위 합치기의 기준)
  change_set_id     uuid REFERENCES vault.change_sets(id),      -- 어느 변경 묶음에서 나왔는지
  body_md           text NOT NULL,
  sections          jsonb NOT NULL,                             -- md 제목(##) 단위 칸: [{ key, title, body }]
  section_hashes    jsonb NOT NULL,
  content_hash      text NOT NULL,
  actor_type        text NOT NULL CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id          uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wiki_id, seq)
);
CREATE INDEX wiki_revisions_base       ON vault.wiki_revisions (base_revision_id);
CREATE INDEX wiki_revisions_change_set ON vault.wiki_revisions (change_set_id);
CREATE TRIGGER wiki_revisions_append_only
  BEFORE UPDATE OR DELETE ON vault.wiki_revisions
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_delete();

ALTER TABLE vault.wikis
  ADD COLUMN head_revision_id uuid,
  ADD COLUMN pinned_sections  text[] NOT NULL DEFAULT '{}',   -- 사람이 고친 칸. AI가 바꾸려 하면 검토로
  ADD COLUMN head_text        text,                           -- 찾기용 본문 복사본
  ADD COLUMN revision_count   int NOT NULL DEFAULT 0;
ALTER TABLE vault.wikis
  ADD CONSTRAINT wikis_head_revision_fk FOREIGN KEY (head_revision_id)
  REFERENCES vault.wiki_revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX wikis_head_revision ON vault.wikis (head_revision_id);
CREATE INDEX wikis_text_bigm     ON vault.wikis USING gin (head_text gin_bigm_ops);

-- wiki 옛 주소 (합칠 때) ------------------------------------------------------------------
-- 합쳐져 없어진 wiki id → 남은 wiki. 글의 참고 wiki와 링크가 계속 살아 있게 한다.
-- 다시 합쳐지면 서버가 옛 주소들도 새 wiki로 고쳐 사슬을 만들지 않는다.
CREATE TABLE vault.wiki_aliases (
  old_id         uuid PRIMARY KEY,                           -- 없어진 wiki (영구 삭제됐을 수 있어 외래키 없음)
  space_id       uuid NOT NULL,
  new_id         uuid NOT NULL REFERENCES vault.wikis(node_id) ON DELETE CASCADE,
  change_set_id  uuid REFERENCES vault.change_sets(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wiki_aliases_new        ON vault.wiki_aliases (new_id);
CREATE INDEX wiki_aliases_change_set ON vault.wiki_aliases (change_set_id);

COMMENT ON COLUMN vault.changes.batch_id IS '변경 묶음(vault.change_sets.id). 되돌리기 단위';

-- migrate:down
COMMENT ON COLUMN vault.changes.batch_id IS NULL;

DROP TABLE vault.wiki_aliases;

DROP INDEX vault.wikis_text_bigm;
DROP INDEX vault.wikis_head_revision;
ALTER TABLE vault.wikis DROP CONSTRAINT wikis_head_revision_fk;
ALTER TABLE vault.wikis
  DROP COLUMN revision_count,
  DROP COLUMN head_text,
  DROP COLUMN pinned_sections,
  DROP COLUMN head_revision_id;

DROP TABLE vault.wiki_revisions;

CREATE TABLE vault.proposals (
  id             uuid PRIMARY KEY DEFAULT platform.uuid_v7(),
  space_id       uuid NOT NULL,
  kind           text NOT NULL,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'accepted', 'rejected', 'deferred', 'superseded')),
  target_ids     uuid[] NOT NULL DEFAULT '{}',
  base_versions  jsonb NOT NULL DEFAULT '{}',
  payload        jsonb NOT NULL DEFAULT '{}',
  actor_type     text CHECK (actor_type IN ('user', 'device', 'ai', 'system')),
  actor_id       uuid,
  job_id         uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     uuid
);
CREATE INDEX proposals_job_idx     ON vault.proposals (job_id);
CREATE INDEX proposals_open_idx    ON vault.proposals (space_id, created_at DESC) WHERE status = 'open';
CREATE INDEX proposals_targets_idx ON vault.proposals USING gin (target_ids);

DROP TABLE vault.review_rules;
DROP TABLE vault.change_ops;
DROP TABLE vault.change_sets;
