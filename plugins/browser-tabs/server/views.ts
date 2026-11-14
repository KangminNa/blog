import type { ScreenShot } from './screen.gateway';
import type { ReadRow, SiteRow } from './tables';

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

/** 사이트 하나 (콘솔). 로그인 필요 표시는 러너가 로그인 화면을 만난 때 */
export class SiteView {
  constructor(private readonly row: Readonly<SiteRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      startUrl: r.start_url,
      origins: r.origins,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
      loginNeededAt: r.login_needed_at?.toISOString() ?? null,
    };
  }
}

/** 사이트 목록 (콘솔) */
export class SiteListView {
  constructor(private readonly sites: readonly SiteView[]) {}

  toJSON() {
    return { sites: this.sites.map((s) => s.toJSON()) };
  }
}

/** 작업을 맡겼다 (작업은 코어가 곧 만든다) */
export class AskedView {
  constructor(private readonly requestId: string) {}

  toJSON() {
    return { requestId: this.requestId };
  }
}

/** 사이트 세션을 지웠다: 지운 쿠키 수 */
export class ClearedView {
  constructor(private readonly cleared: number) {}

  toJSON() {
    return { cleared: this.cleared };
  }
}

/** 서버 브라우저의 화면 (관리자): 탭 목록, 그린 탭, JPEG(base64), 클릭 좌표의 기준 크기 */
export class ScreenView {
  constructor(private readonly shot: ScreenShot) {}

  toJSON() {
    const s = this.shot;
    return { tabs: s.tabs, tab: s.tab, image: s.image, width: s.width, height: s.height };
  }
}

/** 화면에 동작을 보냈다 */
export class ControlledView {
  toJSON() {
    return { ok: true };
  }
}

/** 이벤트를 이 패키지가 다뤘는가 (이 패키지의 동작이 아니면 false) */
export class ConfirmedView {
  constructor(private readonly confirmed: boolean) {}

  toJSON() {
    return { confirmed: this.confirmed };
  }
}
