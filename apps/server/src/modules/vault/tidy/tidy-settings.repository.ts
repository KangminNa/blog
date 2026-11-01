import { BaseRepository, Conflict, type Row } from '../../platform';
import { TidySettings } from './tidy-settings';

// vault.tidy_settings ↔ TidySettings. 정리 일 요청도 저장할 때 outbox로 나간다.
export class TidySettingsRepository extends BaseRepository<TidySettings> {
  protected toEntity(row: Row): TidySettings {
    return TidySettings.restore(
      String(row.space_id),
      Number(row.version),
      Boolean(row.auto_tidy),
      new Date(row.updated_at),
    );
  }

  /** 공간의 설정을 잠근다. 행이 없으면 꺼짐으로 시작한다 */
  async lock(spaceId: string, now: Date): Promise<TidySettings> {
    const found = this.maybeOne(
      await this.sql`SELECT * FROM vault.tidy_settings WHERE space_id = ${spaceId} FOR UPDATE`,
    );
    return found ?? TidySettings.absent(spaceId, now);
  }

  async save(settings: TidySettings): Promise<void> {
    if (settings.changed && settings.isNew) {
      const inserted = await this.sql`
        INSERT INTO vault.tidy_settings (space_id, auto_tidy, updated_at)
        VALUES (${settings.spaceId}, ${settings.autoTidy}, ${settings.updatedAt})
        ON CONFLICT (space_id) DO NOTHING
        RETURNING space_id`;
      if (inserted.length === 0) throw new Conflict('다른 곳에서 먼저 바뀌었어요');
      settings.markSaved(1);
    } else if (settings.changed) {
      const update = await this.sql`
        UPDATE vault.tidy_settings SET ${this.sql(settings.changes)}, version = version + 1
        WHERE space_id = ${settings.spaceId} AND version = ${settings.version}`;
      this.expectUpdated(update.count, settings);
    }
    settings.clearChanges();
    await this.publishEvents(settings);
  }
}
