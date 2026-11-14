import type { ClickRow, ShotRow, SiteRow } from './tables';

// 브라우저 작업 · 결재된 클릭 · 화면이 내보내는 모양. 콘솔(관리자)은 camelCase, 러너 · 에이전트(MCP)는 snake_case.
// 화면 그림(bytea)은 목록에 싣지 않는다: 하나를 열 때만 base64로.

/** 화면 줄에서 그림을 뺀 것 (목록은 그림 없이 읽는다) */
export type ShotMeta = Omit<ShotRow, 'image'>;

/** browser_job의 답: 사이트 일인지 둘러보기인지, 사이트의 값, 로그인이 필요한지, 앞에서 붙잡은 페이지 */
export class JobView {
  constructor(
    private readonly site: Readonly<SiteRow> | null,
    private readonly held: Readonly<ClickRow> | null,
  ) {}

  toJSON() {
    const { site, held } = this;
    return {
      mode: site ? 'site' : 'explore',
      site: site
        ? {
            id: site.id,
            version: site.version,
            name: site.name,
            start_url: site.start_url,
            origins: site.origins,
          }
        : null,
      login_needed: site?.login_needed_at != null,
      held: held ? { click_id: held.id, page_url: held.page_url, tab_id: held.tab_id } : null,
    };
  }
}

/** browser_sites의 답 (에이전트가 사이트를 고를 때): 결재 · 위임의 target_id · target_version으로 쓴다 */
export class AgentSitesView {
  constructor(private readonly sites: readonly Readonly<SiteRow>[]) {}

  toJSON() {
    return {
      sites: this.sites.map((s) => ({
        id: s.id,
        version: s.version,
        name: s.name,
        start_url: s.start_url,
        origins: s.origins,
        login_needed: s.login_needed_at !== null,
      })),
    };
  }
}

/** browser_click_hold의 답: 결재(browser.site.publish)의 대상 browser_click · id · 판 */
export class HeldView {
  constructor(private readonly row: Readonly<ClickRow>) {}

  toJSON() {
    return { click_id: this.row.id, version: this.row.version };
  }
}

/** browser_login_needed의 답: 결재(browser.site.login)의 대상 browser_site · id · 판 */
export class LoginNoticedView {
  constructor(private readonly site: Readonly<SiteRow>) {}

  toJSON() {
    return { site_id: this.site.id, site_version: this.site.version };
  }
}

/** browser_click_next의 답: 이 러너가 누를 클릭 하나 (없으면 null) */
export class NextClickView {
  constructor(private readonly row: Readonly<ClickRow> | null) {}

  toJSON() {
    const r = this.row;
    return {
      click: r
        ? {
            id: r.id,
            version: r.version,
            task_id: r.task_id,
            tab_id: r.tab_id,
            page_url: r.page_url,
            role: r.role,
            name: r.name,
            nth: r.nth,
            fingerprint: r.fingerprint,
          }
        : null,
    };
  }
}

/** browser_click_save의 답 */
export class ClickSavedView {
  constructor(private readonly row: Readonly<ClickRow>) {}

  toJSON() {
    return { id: this.row.id, status: this.row.status };
  }
}

/** browser_shot_save의 답 */
export class ShotSavedView {
  constructor(
    private readonly id: string,
    private readonly seq: number,
  ) {}

  toJSON() {
    return { id: this.id, seq: this.seq };
  }
}

/** 화면 하나의 머리 (콘솔 목록) */
export class ShotView {
  constructor(private readonly row: Readonly<ShotMeta>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      taskId: r.task_id,
      clickId: r.click_id,
      kind: r.kind,
      seq: r.seq,
      url: r.url,
      title: r.title,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 작업의 화면 목록 (콘솔) */
export class ShotListView {
  constructor(private readonly rows: readonly Readonly<ShotMeta>[]) {}

  toJSON() {
    return { shots: this.rows.map((r) => new ShotView(r).toJSON()) };
  }
}

/** 화면 하나와 그림 (콘솔) */
export class ShotImageView {
  constructor(private readonly row: Readonly<ShotRow>) {}

  toJSON() {
    const r = this.row;
    return {
      ...new ShotView(r).toJSON(),
      mime: r.mime,
      image: r.image.toString('base64'),
    };
  }
}

/** 결재된 클릭 하나 (콘솔 목록) */
export class ClickView {
  constructor(
    private readonly row: Readonly<ClickRow>,
    private readonly siteName: string | null,
  ) {}

  toJSON() {
    const r = this.row;
    const box = r.box as { x?: number; y?: number; width?: number; height?: number } | null;
    return {
      id: r.id,
      taskId: r.task_id,
      siteId: r.site_id,
      siteName: this.siteName,
      /** 콘솔 화면에서 그 탭을 고를 때 */
      tabId: r.tab_id,
      pageUrl: r.page_url,
      pageTitle: r.page_title,
      role: r.role,
      name: r.name,
      nth: r.nth,
      box: {
        x: Number(box?.x ?? 0),
        y: Number(box?.y ?? 0),
        width: Number(box?.width ?? 0),
        height: Number(box?.height ?? 0),
      },
      note: r.note,
      status: r.status,
      reason: r.reason,
      afterUrl: r.after_url,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      decidedAt: r.decided_at?.toISOString() ?? null,
      clickedAt: r.clicked_at?.toISOString() ?? null,
    };
  }
}

/** 클릭 목록 (콘솔) */
export class ClickListView {
  constructor(private readonly clicks: readonly ClickView[]) {}

  toJSON() {
    return { clicks: this.clicks.map((c) => c.toJSON()) };
  }
}

/** 클릭 하나 (콘솔 · 결재 화면): 멈춘 화면과 누른 뒤(또는 바뀐) 화면, 그 작업의 단계 화면 목록 */
export class ClickDetailView {
  constructor(
    private readonly click: ClickView,
    private readonly before: Readonly<ShotRow> | null,
    private readonly after: Readonly<ShotRow> | null,
    private readonly shots: readonly Readonly<ShotMeta>[],
  ) {}

  toJSON() {
    return {
      ...this.click.toJSON(),
      beforeImage: this.before?.image.toString('base64') ?? null,
      afterImage: this.after?.image.toString('base64') ?? null,
      afterKind: this.after?.kind ?? null,
      shots: this.shots.map((s) => new ShotView(s).toJSON()),
    };
  }
}
