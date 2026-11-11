import { BaseRepository } from '../base/base-repository';
import { Conflict } from '../base/errors';
import type { EntityStore } from '../base/table-repository';
import { type LoadedNoticeSettings, NoticeSettings } from './notice-settings';

// platform.notice_settings ↔ NoticeSettings. 공간마다 한 행이고 열쇠가 space_id다.
// 행이 없는 공간은 version 0인 기본값으로 읽고, 처음 저장할 때 넣는다.
export class NoticeSettingsRepository
  extends BaseRepository<NoticeSettings>
  implements EntityStore<NoticeSettings>
{
  protected toEntity(row: LoadedNoticeSettings): NoticeSettings {
    return NoticeSettings.restore(row);
  }

  /** 공간의 설정 (잠그지 않음). 없으면 기본값 */
  async load(spaceId: string): Promise<NoticeSettings> {
    return (
      this.maybeOne(
        await this
          .sql`SELECT *, space_id AS id FROM platform.notice_settings WHERE space_id = ${spaceId}`,
      ) ?? NoticeSettings.absent(spaceId)
    );
  }

  /** 공간의 설정을 잠근다. 없으면 기본값으로 시작한다 */
  async lock(spaceId: string): Promise<NoticeSettings> {
    return (
      this.maybeOne(
        await this.sql`
          SELECT *, space_id AS id FROM platform.notice_settings WHERE space_id = ${spaceId} FOR UPDATE`,
      ) ?? NoticeSettings.absent(spaceId)
    );
  }

  async save(settings: NoticeSettings): Promise<void> {
    if (Object.keys(settings.unsaved).length === 0) return;
    if (settings.version === 0) await this.insert(settings);
    else await this.update(settings);
  }

  /** 그사이 다른 쪽이 먼저 넣었으면 Conflict */
  private async insert(settings: NoticeSettings): Promise<void> {
    const columns = { ...settings.unsaved, space_id: settings.id };
    const [row] = await this.sql<LoadedNoticeSettings[]>`
      INSERT INTO platform.notice_settings ${this.sql(columns as never)}
      ON CONFLICT (space_id) DO NOTHING
      RETURNING *, space_id AS id`;
    if (!row) throw new Conflict('다른 곳에서 먼저 바뀌었어요');
    settings.saved(row);
  }

  private async update(settings: NoticeSettings): Promise<void> {
    const rows = await this.sql<LoadedNoticeSettings[]>`
      UPDATE platform.notice_settings SET ${this.sql(settings.unsaved as never)}, version = version + 1
      WHERE space_id = ${settings.id} AND version = ${settings.version}
      RETURNING *, space_id AS id`;
    this.expectUpdated(rows.length, settings);
    settings.saved(rows[0] as LoadedNoticeSettings);
  }
}
