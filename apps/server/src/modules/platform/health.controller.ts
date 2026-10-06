import { Controller, Get, Inject } from '@nestjs/common';
import { SQL, type Sql } from './sql';

@Controller('health')
export class HealthController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  // DB 연결, 확장, 적용된 마이그레이션, 스키마별 테이블 수를 확인한다.
  @Get()
  async check() {
    const extensions = await this.sql<{ extname: string; extversion: string }[]>`
      SELECT extname, extversion FROM pg_extension
      WHERE extname IN ('vector', 'pg_bigm', 'pgcrypto') ORDER BY extname`;
    const migrations = await this.sql<{ version: string }[]>`
      SELECT version FROM public.schema_migrations ORDER BY version`;
    const tables = await this.sql<{ schema: string; count: number }[]>`
      SELECT table_schema AS schema, count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema IN ('app', 'vault', 'blog', 'work') AND table_type = 'BASE TABLE'
      GROUP BY table_schema ORDER BY table_schema`;

    return {
      status: 'ok',
      extensions,
      migrations: migrations.map((m) => m.version),
      tables,
    };
  }
}
