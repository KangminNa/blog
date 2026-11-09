import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import postgres from 'postgres';
import { Busy } from './errors';

// DB 연결과 트랜잭션. `postgres` 라이브러리를 import하는 유일한 파일이다.
// ORM 등을 붙일 때는 이 클래스에 추가하고, 모듈 코드는 BaseRepository·BaseQuery를 통해서만 쓴다.
// 연결 규칙은 platform/CLAUDE.md "DB 연결": 프로세스마다 풀 하나, 연결마다 시간 제한(LIMITS).

/** SQL 실행기 (연결 또는 트랜잭션). 외부 라이브러리 타입을 가리키는 별칭 */
export type Sql = postgres.Sql;
export type Row = postgres.Row;

@Injectable()
export class Database implements OnApplicationShutdown {
  /**
   * 연결마다 거는 시간 제한. 풀과 LISTEN 연결이 모두 시작할 때 받는다.
   * 잠금 하나를 오래 쥔 쪽이 있어도 기다리는 요청이 연결을 붙잡고 풀(10개)을 다 쓰지 않게 한다.
   * 잠금 대기 · 긴 쿼리는 입구에서 Busy(503)가 되고, 쉬다 끊긴 트랜잭션은 우리 코드의 버그라 500으로 둔다.
   * 값은 밀리초 (Postgres는 단위 없는 값을 밀리초로 읽는다)
   */
  static readonly LIMITS = {
    /** 잠금을 5초 넘게 기다리지 않는다 (트랜잭션은 짧다는 원칙상 넘을 일이 없다) */
    lock_timeout: 5_000,
    /** 쿼리 하나는 30초까지 (검색 같은 무거운 읽기에 여유) */
    statement_timeout: 30_000,
    /** 트랜잭션을 연 채 60초 쉬면 끊어 잠금을 푼다 */
    idle_in_transaction_session_timeout: 60_000,
  } as const;
  /** 시간 제한에 걸린 오류의 코드: 잠금 대기(lock_not_available), 긴 쿼리(query_canceled) */
  private static readonly TIMED_OUT: readonly string[] = ['55P03', '57014'];
  /** bigint도 number로 읽는다. 쓰는 값(토큰 수, 파일 크기, 순번)은 안전한 정수 범위 안이다 */
  private static readonly BIGINT = { to: 20, from: [20], serialize: String, parse: Number };
  readonly sql: Sql;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    this.sql = postgres(url, {
      max: 10,
      types: { bigint: Database.BIGINT },
      connection: Database.LIMITS,
    });
  }

  /** 짧은 트랜잭션 하나. 안에서 외부 호출이나 AI 응답을 기다리지 않는다 (LIMITS 안에서 돈다) */
  transaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return this.sql.begin((tx) => work(tx as unknown as Sql)) as Promise<T>;
  }

  /**
   * 시간 제한 없는 트랜잭션. 복원(쓰기)과 복원을 피하는 읽기(steadyRead) 두 곳만 쓴다:
   * 큰 복원은 오래 걸리고, steadyRead는 읽는 동안 잠금만 쥐고 쉰다. 새 자리에 쓰기 전에 일을 나눌 수 있는지 먼저 본다.
   * SET LOCAL이라 이 트랜잭션이 끝나면 연결은 LIMITS로 돌아간다
   */
  unlimitedTransaction<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      for (const name of Object.keys(Database.LIMITS))
        await tx`SELECT set_config(${name}, '0', true)`;
      return work(tx);
    });
  }

  /** 시간 제한(LIMITS)에 걸린 오류면 Busy, 아니면 null. 입구(REST 필터, MCP)가 응답을 만들 때 묻는다 */
  static busy(error: unknown): Busy | null {
    return error instanceof postgres.PostgresError && Database.TIMED_OUT.includes(error.code)
      ? new Busy()
      : null;
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
