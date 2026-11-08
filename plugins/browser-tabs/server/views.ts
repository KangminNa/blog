import type { ReadRow } from './tables';

// 이 패키지가 내보내는 모양. 보는 사람마다 나눈다: 콘솔(주인)은 camelCase, 러너(MCP)는 snake_case.

/** 콘솔 목록의 한 줄. 본문은 앞부분만 (전체는 크다) */
export class ReadView {
  static readonly PREVIEW = 400;

  constructor(private readonly row: Readonly<ReadRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      url: r.url,
      status: r.status,
      title: r.title,
      preview: r.body?.slice(0, ReadView.PREVIEW) ?? null,
      error: r.error,
      requestedAt: r.requested_at.toISOString(),
      readAt: r.read_at?.toISOString() ?? null,
    };
  }
}

/** 콘솔 목록 */
export class ReadListView {
  constructor(private readonly reads: readonly ReadView[]) {}

  toJSON() {
    return { reads: this.reads.map((r) => r.toJSON()) };
  }
}

/** browser_tab_pending의 답 (러너에게) */
export class PendingView {
  constructor(private readonly rows: readonly Readonly<ReadRow>[]) {}

  toJSON() {
    return { reads: this.rows.map((r) => ({ id: r.id, url: r.url })) };
  }
}

/** browser_tab_save의 답 */
export class SavedView {
  constructor(
    private readonly id: string,
    private readonly status: string,
  ) {}

  toJSON() {
    return { id: this.id, status: this.status };
  }
}
