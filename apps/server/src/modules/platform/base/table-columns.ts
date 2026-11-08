// 기능 패키지의 생성된 표(plugins/<이름>/server/schema.ts)가 쓰는 Drizzle 칸 만들기.
// 패키지는 drizzle-orm을 직접 가져오지 않고 plugin-api의 TableColumns로만 쓴다 (코어 모듈의 생성된 표는 직접 가져온다).
export {
  bigint,
  boolean,
  customType,
  doublePrecision,
  inet,
  integer,
  jsonb,
  pgSchema,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
