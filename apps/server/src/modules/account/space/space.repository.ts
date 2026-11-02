import { TableRepository } from '../../platform';
import type { SpaceRow } from '../account.tables';
import { Space } from './space';
import type { SpaceWithSettings } from './space.view';

// account.spaces + settings ↔ Space. 공간은 지금 하나라 "가장 먼저 만든 공간"이 그 공간이다.
// 설정은 키 하나에 행 하나(값은 jsonb).
export class SpaceRepository extends TableRepository<SpaceRow, Space> {
  protected readonly table = 'account.spaces';
  protected readonly noun = '블로그 공간';

  protected toEntity(row: SpaceWithSettings): Space {
    return Space.restore(row);
  }

  async current(): Promise<Space | null> {
    return this.maybeOne(await this.first(false));
  }

  /** 트랜잭션 안에서 잠그고 읽는다 */
  async lockCurrent(): Promise<Space | null> {
    return this.maybeOne(await this.first(true));
  }

  /** 공간의 행 그대로. Query가 View에 넘긴다 */
  async currentRow(): Promise<SpaceWithSettings | null> {
    const [row] = await this.first(false);
    return (row as SpaceWithSettings | undefined) ?? null;
  }

  /** 공간은 하나뿐이라 id로 고르지 않는다 */
  protected override select(_spaceId: string, _id: string, lock: boolean) {
    return this.first(lock);
  }

  protected override async saveParts(space: Space): Promise<void> {
    for (const [key, value] of Object.entries(space.unsavedSettings)) {
      if (value === null) {
        await this.sql`DELETE FROM account.settings WHERE space_id = ${space.id} AND key = ${key}`;
        continue;
      }
      await this.sql`
        INSERT INTO account.settings (space_id, key, value) VALUES (${space.id}, ${key}, ${this.sql.json(value)})
        ON CONFLICT (space_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
  }

  private first(lock: boolean) {
    return this.sql`
      SELECT s.*,
             (SELECT jsonb_object_agg(key, value) FROM account.settings WHERE space_id = s.id) AS settings
      FROM account.spaces s
      ORDER BY s.created_at LIMIT 1
      ${lock ? this.sql`FOR UPDATE OF s` : this.sql``}`;
  }
}
