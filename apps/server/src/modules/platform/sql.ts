import type postgres from 'postgres';

// DB 연결 주입 토큰. 모듈 파일과 분리해 순환 import를 피한다.
export const SQL = Symbol('SQL');
export type Sql = postgres.Sql;
