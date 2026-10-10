---
paths:
  - "db/migrations/**"
---

# 마이그레이션 규칙

- 새 파일은 `pnpm db:new <영문_이름>`으로 만든다. 커밋된 파일은 고치지 않는다.
- 모든 파일에 `-- migrate:up`과 `-- migrate:down`을 둔다. down은 up을 정확히 되돌린다 (CI가 전부 되돌렸다 다시 적용해 본다).
- 테이블은 스키마를 붙여 만든다: `app`(계정·운영) · `vault`(세션·그래프) · `blog`(글) · `work`(글감 상자). vault ↔ blog 사이에 외래키 금지.
- 기본키는 `uuid DEFAULT app.uuid_v7()`, 시간은 `timestamptz NOT NULL DEFAULT now()`.
- 판(revision) 테이블은 `app.forbid_update_delete()` 트리거를 붙여 추가만 허용한다.
- 값의 범위는 `CHECK`로 DB에서 막는다 (상태값, 권한 목록, 해시 길이 등).
- 인덱스는 실제 조회를 위해서만 만들고, 왜 필요한지 주석이나 [테이블 설계](../../docs/테이블설계.md)에 남긴다. 자주 거르는 조건은 부분 인덱스(`WHERE deleted_at IS NULL`)로.
- 한국어 검색은 `gin (col gin_bigm_ops)`, 벡터는 모델별 부분 HNSW 인덱스.
- 테이블을 바꾸면 `docs/테이블설계.md`도 함께 고친다.
