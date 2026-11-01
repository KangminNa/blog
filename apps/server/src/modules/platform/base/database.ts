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

  /**
   * 채널을 듣는다 (Postgres LISTEN). 라이브러리가 듣기 전용 연결을 하나 따로 쓰고, 끊기면 다시 듣는다.
   * 끊긴 동안의 신호는 사라진다: 신호는 깨우기용이고 내용은 늘 테이블에 있다. 돌려준 함수로 그만 듣는다.
   * 단 다시 연결한 뒤에는 이 함수가 듣기를 빼지 못한다 (라이브러리가 받는 쪽을 새로 등록한다). 연결을 닫으면 끝난다.
   * onReady는 처음 들을 때와 다시 연결해 들을 때마다 불린다. 놓친 신호를 메우려면 여기서 테이블을 다시 본다.
   */
  async listen(
    channel: string,
    onMessage: (payload: string) => void,
    onReady?: () => void,
  ): Promise<() => Promise<void>> {
    const { unlisten } = await this.sql.listen(channel, onMessage, onReady);
    return unlisten;
  }

  /** 유일 제약에 걸린 오류인가 (동시에 같은 것을 만들려 할 때). Repository가 Conflict로 바꾼다 */
  static isUniqueViolation(error: unknown, constraint?: string): boolean {
    if (!(error instanceof postgres.PostgresError) || error.code !== '23505') return false;
    return constraint === undefined || error.constraint_name === constraint;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}
