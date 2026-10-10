import { BaseRepository, type Row } from '../../platform';
import { Space } from './space';

// account.spaces + settings ↔ Space. 공간은 지금 하나라 "가장 먼저 만든 공간"이 그 공간이다.
// 설정은 키 하나에 행 하나(값은 jsonb).
export class SpaceRepository extends BaseRepository<Space> {
  protected toEntity(row: Row): Space {
    const settings = (row.settings ?? {}) as Record<string, unknown>;
    const text = (key: string) =>
      typeof settings[key] === 'string' ? String(settings[key]) : null;
    return Space.restore(
      String(row.id),
      Number(row.version),
      String(row.slug),
      String(row.name),
      text('blog.description') ?? '',
      text('site.url'),
    );
  }

  async current(): Promise<Space | null> {
    return this.maybeOne(await this.select(false));
  }

  /** 트랜잭션 안에서 잠그고 읽는다 */
  async lockCurrent(): Promise<Space | null> {
    return this.maybeOne(await this.select(true));
  }

  async save(space: Space): Promise<void> {
    if (space.isNew) {
      await this.sql`
        INSERT INTO account.spaces (id, slug, name) VALUES (${space.id}, ${space.slug}, ${space.name})`;
      space.markSaved(space.version);
    } else {
      const result = await this.sql`
        UPDATE account.spaces SET name = ${space.name}, version = version + 1
        WHERE id = ${space.id} AND version = ${space.version}`;
      this.expectUpdated(result.count, space);
    }
    const settings: Record<string, string | null> = {
      'blog.description': space.description || null,
      'site.url': space.siteUrl,
    };
    for (const [key, value] of Object.entries(settings)) {
      if (value === null) {
        await this.sql`DELETE FROM account.settings WHERE space_id = ${space.id} AND key = ${key}`;
        continue;
      }
      await this.sql`
        INSERT INTO account.settings (space_id, key, value) VALUES (${space.id}, ${key}, ${this.sql.json(value)})
        ON CONFLICT (space_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
    await this.publishEvents(space);
  }

  private select(lock: boolean) {
    return this.sql`
      SELECT s.*,
             (SELECT jsonb_object_agg(key, value) FROM account.settings WHERE space_id = s.id) AS settings
      FROM account.spaces s
      ORDER BY s.created_at LIMIT 1
      ${lock ? this.sql`FOR UPDATE OF s` : this.sql``}`;
  }
}
