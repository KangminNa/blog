import { BaseRepository } from '../base/base-repository';
import type { NotificationRow } from '../platform.tables';
import type { PendingNotice } from './notice.policy';
import type { PushSubscription, PushTarget } from './push-subscription';

// 브라우저 푸시의 저장 (7단계): 구독(push_subscriptions)과 아직 푸시를 다루지 않은 알림(notifications.push_sent_at).
// 구독은 주소(endpoint)가 유일해서 같은 브라우저가 다시 맡기면 바꾼다.
export class PushRepository extends BaseRepository<PushSubscription> {
  protected toEntity(): PushSubscription {
    throw new Error('구독은 행으로만 읽는다');
  }

  /** 넣거나, 같은 주소가 있으면 키와 공간을 바꾸고 실패 수를 지운다 */
  async upsert(subscription: PushSubscription): Promise<void> {
    const row = subscription.newRow;
    await this.sql`
      INSERT INTO platform.push_subscriptions ${this.sql(row as never)}
      ON CONFLICT (endpoint) DO UPDATE SET
        space_id = EXCLUDED.space_id, user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, fail_count = 0`;
  }

  /** 이 공간의 그 주소를 지운다. 지운 수 */
  async remove(spaceId: string, endpoint: string): Promise<number> {
    const rows = await this.sql`
      DELETE FROM platform.push_subscriptions WHERE space_id = ${spaceId} AND endpoint = ${endpoint}
      RETURNING id`;
    return rows.length;
  }

  /** 공간의 구독. endpoint가 있으면 그 하나만 */
  async targets(spaceId: string, endpoint: string | null = null): Promise<PushTarget[]> {
    return [
      ...(await this.sql<PushTarget[]>`
        SELECT id, endpoint, p256dh, auth FROM platform.push_subscriptions
        WHERE space_id = ${spaceId} ${endpoint === null ? this.sql`` : this.sql`AND endpoint = ${endpoint}`}
        ORDER BY id`),
    ];
  }

  /** 받은 구독은 실패 수를 지우고, 사라진 구독(404 · 410)과 실패가 쌓인 구독은 지운다 */
  async record(id: string, status: number, now: Date, failsMax: number): Promise<void> {
    if (status >= 200 && status < 300) {
      await this.sql`
        UPDATE platform.push_subscriptions SET last_success_at = ${now}, fail_count = 0 WHERE id = ${id}`;
      return;
    }
    if (status === 404 || status === 410) {
      await this.sql`DELETE FROM platform.push_subscriptions WHERE id = ${id}`;
      return;
    }
    await this.sql`
      WITH bumped AS (
        UPDATE platform.push_subscriptions SET fail_count = fail_count + 1 WHERE id = ${id}
        RETURNING id, fail_count)
      DELETE FROM platform.push_subscriptions
      WHERE id IN (SELECT id FROM bumped WHERE fail_count >= ${failsMax})`;
  }

  /** 아직 푸시를 다루지 않은 알림이 있는 공간 */
  async pendingSpaces(): Promise<string[]> {
    const rows = await this.sql<Pick<NotificationRow, 'space_id'>[]>`
      SELECT DISTINCT space_id FROM platform.notifications
      WHERE push_sent_at IS NULL AND severity <> 'log'`;
    return rows.map((r) => r.space_id);
  }

  /** 공간의 아직 다루지 않은 알림을 잠근다 (다른 일꾼이 잡은 줄은 건너뛴다) */
  async lockPending(spaceId: string, limit: number): Promise<PendingNotice[]> {
    return [
      ...(await this.sql<PendingNotice[]>`
        SELECT id, kind, severity, title, body, link, created_at FROM platform.notifications
        WHERE space_id = ${spaceId} AND push_sent_at IS NULL AND severity <> 'log'
        ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`),
    ];
  }

  /** 다룬 알림 (보냈거나 보내지 않기로 함) */
  async markHandled(ids: readonly string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.sql`
      UPDATE platform.notifications SET push_sent_at = ${now} WHERE id = ANY(${ids as string[]}::uuid[])`;
  }
}
