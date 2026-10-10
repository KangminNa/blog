import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import postgres from 'postgres';

// DB 연결과 트랜잭션. `postgres` 라이브러리를 import하는 유일한 파일이다.
// ORM 등을 붙일 때는 이 클래스에 추가하고, 모듈 코드는 BaseRepository·BaseQuery를 통해서만 쓴다.

/** SQL 실행기 (연결 또는 트랜잭션). 외부 라이브러리 타입을 가리키는 별칭 */
export type Sql = postgres.Sql;
export type Row = postgres.Row;

@Injectable()
export class Database implements OnApplicationShutdown {
  readonly sql: Sql;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    this.sql = postgres(url, { max: 10 });
  }

  /** 짧은 트랜잭션 하나. 안에서 외부 호출이나 AI 응답을 기다리지 않는다 */
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin((tx) => work(tx as unknown as Sql)) as Promise<T>;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
