import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseQuery } from '../base/base-query';
import type { NotificationRow } from '../platform.tables';
import { NotificationListView } from './notification.view';

// 알림 읽기 (주인만). 최근 것부터 LIMIT개와 안 읽은 수.
@Injectable()
export class NotificationQuery extends BaseQuery {
  private static readonly LIMIT = 30;

  async list(actor: Actor): Promise<NotificationListView> {
    actor.assertOwner();
    const space = actor.requireSpace();
    const [rows, [count]] = await Promise.all([
      this.sql<NotificationRow[]>`
        SELECT * FROM platform.notifications WHERE space_id = ${space}
        ORDER BY created_at DESC, id DESC LIMIT ${NotificationQuery.LIMIT}`,
      this.sql<{ unread: number }[]>`
        SELECT count(*)::int AS unread FROM platform.notifications
        WHERE space_id = ${space} AND read_at IS NULL`,
    ]);
    return new NotificationListView(rows, count?.unread ?? 0);
  }
}
