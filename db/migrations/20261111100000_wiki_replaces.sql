-- migrate:up
-- wiki 점수 2단계 (docs/wiki점수.md): 새 wiki가 옛 wiki의 결론을 뒤집으면 대체로 표시한다.
-- 대체한 wiki는 옛 wiki의 점수를 전부 물려받고, 옛 wiki는 히스토리가 되어 순위에서 빠진다 (선은 남는다).
-- AI도 제안할 수 있지만 늘 승인함을 거친다 (ReviewPolicy의 ReplacesRule).
INSERT INTO vault.edge_kinds (name, directed, ai_creatable, description) VALUES
  ('replaces', true, true, 'wiki → 대체한 옛 wiki. 옛 wiki는 히스토리');
-- 옛 wiki 하나를 대체하는 wiki는 하나뿐이다
CREATE UNIQUE INDEX edges_replaced_once ON vault.edges (dst) WHERE kind = 'replaces' AND deleted_at IS NULL;

-- migrate:down
DROP INDEX vault.edges_replaced_once;
DELETE FROM vault.edges WHERE kind = 'replaces';
DELETE FROM vault.edge_kinds WHERE name = 'replaces';
