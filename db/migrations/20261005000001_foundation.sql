-- migrate:up
-- 확장과 스키마, 공통 함수

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_bigm;

CREATE SCHEMA app;    -- 계정·기기·운영·공통 파일
CREATE SCHEMA vault;  -- 세션·그래프
CREATE SCHEMA blog;   -- 글
CREATE SCHEMA work;   -- 글감 상자

-- UUIDv7 (시간순 정렬). 앱에서 만들어 넣는 것이 기본이고, DB 기본값은 예비용.
CREATE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  b bytea;
BEGIN
  b := substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
       || gen_random_bytes(10);
  b := set_byte(b, 6, (b'0111' || get_byte(b, 6)::bit(4))::bit(8)::int);
  b := set_byte(b, 8, (b'10' || get_byte(b, 8)::bit(6))::bit(8)::int);
  RETURN encode(b, 'hex')::uuid;
END $$;

-- 추가만 허용하는 테이블(판)용 트리거. 영구 삭제 일꾼만 SET LOCAL cairn.allow_purge = 'on' 으로 통과.
CREATE FUNCTION app.forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cairn.allow_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%.% is append-only (% not allowed)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END $$;

-- migrate:down
DROP SCHEMA IF EXISTS work CASCADE;
DROP SCHEMA IF EXISTS blog CASCADE;
DROP SCHEMA IF EXISTS vault CASCADE;
DROP SCHEMA IF EXISTS app CASCADE;
