-- migrate:up
-- 화면에서 "주인" 대신 쓸 이름과 사이트 로고 (기획서 결정 2026-11-14).
-- 표시 이름은 계정(users)의 비어 있던 칸을 쓴다. 고칠 때 version으로 동시 저장을 막는다 (users에는 version이 없었다).
-- 로고는 platform.blobs의 파일을 값으로 가리킨다 (모듈 사이 외래키 없음. 파일 청소는 BlobStore.registerUse로)
ALTER TABLE account.users ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE account.users ADD CONSTRAINT users_display_name_len
  CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40);
ALTER TABLE account.spaces ADD COLUMN logo_blob_hash text;
ALTER TABLE account.spaces ADD CONSTRAINT spaces_logo_hash
  CHECK (logo_blob_hash IS NULL OR logo_blob_hash ~ '^[0-9a-f]{64}$');

-- migrate:down
ALTER TABLE account.spaces DROP CONSTRAINT spaces_logo_hash;
ALTER TABLE account.spaces DROP COLUMN logo_blob_hash;
ALTER TABLE account.users DROP CONSTRAINT users_display_name_len;
ALTER TABLE account.users DROP COLUMN version;
