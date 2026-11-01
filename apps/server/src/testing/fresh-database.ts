import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Database } from '../modules/platform';

// 마이그레이션까지 마친 새 DB. 테스트 전용 DB(cairn_test)는 테스트 파일들이 함께 써서 비어 있지 않다.
// 복원처럼 빈 Cairn이 있어야 하는 테스트가 따로 만들어 쓴다.
export class FreshDatabase {
  private static readonly MIGRATIONS = resolve(process.cwd(), '../../db/migrations');
  private static readonly NAME = /^[a-z_]+$/;

  private constructor(
    private readonly name: string,
    readonly url: string,
  ) {}

  static async create(name: string): Promise<FreshDatabase> {
    if (!FreshDatabase.NAME.test(name)) throw new Error(`DB 이름이 틀렸어요: ${name}`);
    const admin = new Database();
    // 앞선 실행이 남긴 DB만 지운다 (IF EXISTS는 없을 때 알림을 로그에 찍는다)
    const [left] = await admin.sql`SELECT 1 AS found FROM pg_database WHERE datname = ${name}`;
    if (left) await admin.sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.sql.unsafe(`CREATE DATABASE ${name}`);
    await admin.onApplicationShutdown();
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.pathname = `/${name}`;
    const fresh = new FreshDatabase(name, url.toString());
    const db = fresh.connect();
    for (const file of readdirSync(FreshDatabase.MIGRATIONS).sort())
      await db.sql.unsafe(FreshDatabase.upPart(file));
    await db.onApplicationShutdown();
    return fresh;
  }

  /** 이 DB에 연결한다. Database는 만들 때 환경 변수를 읽으므로 그 순간만 바꾼다 */
  connect(): Database {
    return this.during(() => new Database());
  }

  /** 이 DB를 보는 객체를 만드는 동안 환경 변수를 바꿔 둔다 */
  during<T>(work: () => T): T {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = this.url;
    try {
      return work();
    } finally {
      process.env.DATABASE_URL = before;
    }
  }

  async drop(): Promise<void> {
    const admin = new Database();
    await admin.sql.unsafe(`DROP DATABASE IF EXISTS ${this.name} WITH (FORCE)`);
    await admin.onApplicationShutdown();
  }

  private static upPart(file: string): string {
    const text = readFileSync(join(FreshDatabase.MIGRATIONS, file), 'utf8');
    return text.slice(text.indexOf('-- migrate:up'), text.indexOf('-- migrate:down'));
  }
}
