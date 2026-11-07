import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import { HealthDetailView, HealthView } from './health.view';

// DB 연결, 확장, 적용된 마이그레이션, 모듈 스키마별 테이블 수. DB 카탈로그만 읽는다.
@Injectable()
export class HealthQuery extends BaseQuery {
  private static readonly SCHEMAS = ['platform', 'account', 'vault', 'blog', 'work', 'mcp'];

  /** 누구에게나 DB를 읽어 본 뒤에 답한다: DB가 닿지 않으면 방문자의 상태 확인도 실패해야 한다 */
  async status(actor: Actor): Promise<HealthView> {
    const [extensions, migrations, tables] = await Promise.all([
      this.sql`
        SELECT extname, extversion FROM pg_extension
        WHERE extname IN ('vector', 'pg_bigm', 'pgcrypto') ORDER BY extname`,
      this.sql`SELECT version FROM public.schema_migrations ORDER BY version`,
      this.sql`
        SELECT table_schema AS schema, count(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema IN ${this.sql(HealthQuery.SCHEMAS)} AND table_type = 'BASE TABLE'
        GROUP BY table_schema`,
    ]);
    if (!actor.canManage()) return new HealthView();

    const counts = new Map(tables.map((t) => [String(t.schema), Number(t.count)]));
    return new HealthDetailView(
      new Map(extensions.map((e) => [String(e.extname), String(e.extversion)])),
      migrations.map((m) => String(m.version)),
      new Map(HealthQuery.SCHEMAS.map((s) => [s, counts.get(s) ?? 0])),
    );
  }
}
