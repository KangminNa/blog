-- migrate:up
-- wiki 점수 3단계 (docs/wiki점수.md): 지울 만한 wiki로 알린 것.
-- 하루 한 번 일꾼이 지금 후보와 비교해 새로 후보가 된 wiki만 알린다. 점수가 다시 올라가 후보에서 빠지면 줄을 지우고,
-- 다시 내려가면 또 알린다. 알리기만 하고 지우지 않는다: 지우는 것은 주인이다 (원칙 2 · 7).
CREATE TABLE vault.stale_wikis (
  wiki_id     uuid PRIMARY KEY REFERENCES vault.wikis(node_id) ON DELETE CASCADE,
  space_id    uuid NOT NULL,   -- account의 공간 (값만, 외래키 없음)
  score       real NOT NULL,   -- 알린 때의 최종 점수
  noticed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stale_wikis_space_idx ON vault.stale_wikis (space_id);

-- migrate:down
DROP TABLE vault.stale_wikis;
