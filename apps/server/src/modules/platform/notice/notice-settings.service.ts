import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import { Database } from '../base/database';
import { NoticeCatalog } from './notice-catalog';
import type { NoticeSettings } from './notice-settings';
import type { SaveNoticeSettingsInput } from './notice-settings.input';
import { NoticeSettingsRepository } from './notice-settings.repository';
import type { NoticeSettingsView } from './notice-settings.view';

// 알림 설정 쓰기 (7단계). 주인만. 경로는 등록한 알림 종류(NoticeCatalog)에만 적을 수 있다.
@Injectable()
export class NoticeSettingsService extends BaseService {
  constructor(
    db: Database,
    private readonly catalog: NoticeCatalog,
  ) {
    super(db);
  }

  async save(actor: Actor, req: SaveNoticeSettingsInput): Promise<NoticeSettingsView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const kinds = this.catalog.all();
    const settings: NoticeSettings = await this.transaction(async (tx) => {
      const store = new NoticeSettingsRepository(tx);
      const found = await store.lock(spaceId);
      found.assertVersion(req.version);
      found.configure(
        req.settings,
        kinds.map((k) => k.kind),
        new Date(),
      );
      await store.save(found);
      return found;
    });
    return settings.view(kinds);
  }
}
