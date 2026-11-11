import type { Sql } from '../base/database';
import { ChangeSignal } from '../base/outbox';
import type { NotificationNew } from '../platform.tables';

/** 남길 알림: id · 시각은 DB가 정한다 */
export type NoticeNew = Omit<NotificationNew, 'id' | 'created_at' | 'read_at'>;

// 알림을 호출한 쪽의 트랜잭션 안에서 platform.notifications에 남긴다 (Outbox와 같은 자리).
// platform은 무엇을 알리는지 모른다: 제목 · 본문 · 주소는 알리는 모듈이 정한다.
// 같은 묶음 키(group_key)의 안 읽은 알림이 있으면 새로 쌓지 않고 그 알림을 새 내용 · 새 시각으로 바꾼다
// (하루 한 번 알리는 일이 주인이 읽기 전까지 쌓이지 않게). 바꾸면 아직 보내지 않은 것으로 돌린다(push_sent_at).
// 주인이 그 종류를 끄면(알림 설정의 경로 off) 남기지 않는다. 콘솔에는 변경 신호로 바로 닿는다.
// 브라우저 푸시는 NoticePushJob이 같은 표를 읽어 보낸다 (7단계).
export class Notices {
  /** 콘솔이 듣는 변경 신호의 주제 */
  static readonly TOPIC = 'platform.notification';

  constructor(private readonly tx: Sql) {}

  async post(notice: NoticeNew): Promise<void> {
    const [route] = await this.tx<{ route: string | null }[]>`
      SELECT routes->>${notice.kind} AS route FROM platform.notice_settings
      WHERE space_id = ${notice.space_id}`;
    if (route?.route === 'off') return;
    const merged = notice.group_key
      ? await this.tx<{ id: string }[]>`
          UPDATE platform.notifications
          SET title = ${notice.title}, body = ${notice.body ?? null}, link = ${notice.link ?? null},
              data = ${this.tx.json((notice.data ?? {}) as never)}, severity = ${notice.severity},
              created_at = now(), push_sent_at = NULL
          WHERE space_id = ${notice.space_id} AND group_key = ${notice.group_key} AND read_at IS NULL
          RETURNING id`
      : [];
    const [row] = merged.length
      ? merged
      : await this.tx<{ id: string }[]>`
          INSERT INTO platform.notifications ${this.tx({ ...notice, data: this.tx.json((notice.data ?? {}) as never) } as never)}
          RETURNING id`;
    await ChangeSignal.send(this.tx, [
      new ChangeSignal(notice.space_id, Notices.TOPIC, String(row?.id)),
    ]);
  }

  /** 끝난 일의 알림을 읽음으로 (예: 결재가 끝남). 그 묶음 키의 안 읽은 알림이 없으면 아무 일도 없다 */
  async settle(spaceId: string, groupKey: string, now: Date): Promise<void> {
    const rows = await this.tx<{ id: string }[]>`
      UPDATE platform.notifications SET read_at = ${now}
      WHERE space_id = ${spaceId} AND group_key = ${groupKey} AND read_at IS NULL
      RETURNING id`;
    if (rows.length > 0)
      await ChangeSignal.send(this.tx, [
        new ChangeSignal(spaceId, Notices.TOPIC, String(rows[0]?.id)),
      ]);
  }

  /** 읽음으로. ids가 없으면 공간의 안 읽은 알림 모두. 읽음으로 바꾼 수 */
  async read(spaceId: string, ids: readonly string[] | null, now: Date): Promise<number> {
    const rows = await this.tx<{ id: string }[]>`
      UPDATE platform.notifications SET read_at = ${now}
      WHERE space_id = ${spaceId} AND read_at IS NULL
        ${ids === null ? this.tx`` : this.tx`AND id = ANY(${ids as string[]}::uuid[])`}
      RETURNING id`;
    if (rows.length > 0)
      await ChangeSignal.send(this.tx, [
        new ChangeSignal(spaceId, Notices.TOPIC, String(rows[0]?.id)),
      ]);
    return rows.length;
  }
}
