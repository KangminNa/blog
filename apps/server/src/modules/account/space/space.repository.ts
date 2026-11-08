import { TableRepository } from '../../platform';
import { settings, spaces } from '../account.schema';
import type { SettingNew, SpaceRow } from '../account.tables';
import { Space } from './space';
import type { LoadedSpace } from './space.view';

// account.spaces + settings ↔ Space. 공간은 지금 하나라 "가장 먼저 만든 공간"이 그 공간이다.
// 넣기와 고치기(바뀐 칸만)는 기반이 하고, 설정(키 하나에 행 하나, 값은 jsonb)은 saveParts에서 적는다.
export class SpaceRepository extends TableRepository<SpaceRow, Space> {
  protected readonly table = spaces;
  protected readonly noun = '블로그 공간';

  protected toEntity(row: LoadedSpace): Space {
    return Space.restore(row);
  }

  async current(): Promise<Space | null> {
    return this.maybeOne(await this.first(false));
  }

  /** 트랜잭션 안에서 잠그고 읽는다 */
  async lockCurrent(): Promise<Space | null> {
    return this.maybeOne(await this.first(true));
  }

  protected override async saveParts(space: Space): Promise<void> {
    for (const [key, value] of Object.entries(space.unsavedSettings)) {
      if (value === null) {
        await this.deleteRows(settings, { space_id: space.id, key });
        continue;
      }
      const setting: SettingNew = { space_id: space.id, key, value: this.sql.json(value) };
      await this.sql`
        INSERT INTO account.settings ${this.sql(setting as never)}
        ON CONFLICT (space_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
  }

  private first(lock: boolean) {
    return this.sql<LoadedSpace[]>`
      SELECT s.*,
             (SELECT jsonb_object_agg(key, value) FROM account.settings WHERE space_id = s.id) AS settings
      FROM account.spaces s
      ORDER BY s.created_at LIMIT 1
      ${lock ? this.sql`FOR UPDATE OF s` : this.sql``}`;
  }
}
