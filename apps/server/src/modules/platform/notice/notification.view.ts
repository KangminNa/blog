import type { NotificationRow } from '../platform.tables';

// 알림의 읽기 모양 (주인만). 웹이 `import type`으로 가져온다.

/** 알림 한 줄 */
export class NotificationView {
  constructor(private readonly row: Readonly<NotificationRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body,
      /** 누르면 갈 콘솔 주소 */
      link: r.link,
      createdAt: r.created_at.toISOString(),
      read: r.read_at !== null,
    };
  }
}

/** 최근 알림과 안 읽은 수 */
export class NotificationListView {
  constructor(
    private readonly rows: readonly Readonly<NotificationRow>[],
    private readonly unread: number,
  ) {}

  toJSON() {
    return {
      unread: this.unread,
      notifications: this.rows.map((r) => new NotificationView(r).toJSON()),
    };
  }
}

/** 읽음으로 바꾼 수 */
export class NotificationsReadView {
  constructor(private readonly count: number) {}

  toJSON() {
    return { read: this.count };
  }
}
