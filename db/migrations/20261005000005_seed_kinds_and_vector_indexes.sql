-- migrate:up
-- 기본 종류 목록과 첫 임베딩 모델, 모델별 벡터 인덱스

INSERT INTO vault.node_kinds (name, detail_table, description) VALUES
  ('session', 'vault.sessions', 'AI 작업 세션'),
  ('topic',   'vault.topics',   '세션을 묶는 주제');

INSERT INTO vault.edge_kinds (name, directed, ai_creatable, description) VALUES
  ('belongs', true,  true, '세션 → 주제 소속'),
  ('related', false, true, '세션↔세션, 주제↔주제 관련'),
  ('similar', false, true, '의미 검색으로 계산한 비슷함');

-- 첫 모델: 서버 내장 소형 다국어 임베딩 (384차원). 모델 선택은 M2에서 비교 평가 후 확정
INSERT INTO app.embedding_models (id, name, dims, provider, is_active) VALUES
  (1, 'multilingual-e5-small', 384, 'builtin', true);

-- 모델별 HNSW 부분 인덱스. 질의도 같은 형변환과 조건을 써야 이 인덱스를 탄다:
--   ORDER BY embedding::vector(384) <=> $1 ... WHERE model_id = 1
CREATE INDEX chunk_embeddings_m1_hnsw ON vault.chunk_embeddings
  USING hnsw ((embedding::vector(384)) vector_cosine_ops) WHERE model_id = 1;
CREATE INDEX blog_chunk_embeddings_m1_hnsw ON blog.chunk_embeddings
  USING hnsw ((embedding::vector(384)) vector_cosine_ops) WHERE model_id = 1;

-- migrate:down
DROP INDEX IF EXISTS blog.blog_chunk_embeddings_m1_hnsw;
DROP INDEX IF EXISTS vault.chunk_embeddings_m1_hnsw;
DELETE FROM app.embedding_models WHERE id = 1;
DELETE FROM vault.edge_kinds WHERE name IN ('belongs', 'related', 'similar');
DELETE FROM vault.node_kinds WHERE name IN ('session', 'topic');
