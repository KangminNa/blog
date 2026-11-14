import { ButtonRef } from './browser-page';
import type { Json } from './json';

/** 브라우저 작업의 사이트 (browser_job). 결재 · 로그인 필요의 대상이다 */
export class BrowseSite {
  constructor(
    readonly id: string,
    readonly version: number,
    readonly name: string,
    readonly startUrl: string,
    /** 브라우저가 요청할 수 있는 출처 (Playwright MCP의 --allowed-origins) */
    readonly origins: readonly string[],
  ) {}
}

/** 클릭 결재에서 고쳐 달라로 다시 온 일이면 앞에서 붙잡은 페이지 */
export class HeldPage {
  constructor(
    readonly clickId: string,
    readonly pageUrl: string,
    readonly tabId: string,
  ) {}
}

// browser_job의 답: 러너가 빌린 browse 작업이 어디서 도는지 (browser-tabs 패키지가 작업의 대상으로 정한다).
// 사이트 일(대상 browser_site · browser_click)이면 사이트 값과 로그인 필요, 대상이 없으면 둘러보기.
// 서버가 걸렀지만 러너도 출처 모양만 본다: http(s)://호스트[:포트], 경로 없음
export class BrowseJob {
  private static readonly ORIGIN = /^https?:\/\/[^/\s;]+$/i;

  private constructor(
    /** 둘러보기면 null */
    readonly site: BrowseSite | null,
    readonly loginNeeded: boolean,
    readonly held: HeldPage | null,
  ) {}

  static from(body: Json): BrowseJob {
    const site = body.field('site') ? body.child('site') : null;
    const held = body.field('held') ? body.child('held') : null;
    return new BrowseJob(
      site === null
        ? null
        : new BrowseSite(
            site.text('id'),
            site.number('version'),
            site.text('name'),
            site.text('start_url'),
            site.texts('origins').filter((o) => BrowseJob.ORIGIN.test(o)),
          ),
      body.flag('login_needed'),
      held === null
        ? null
        : new HeldPage(held.text('click_id'), held.text('page_url'), held.text('tab_id')),
    );
  }

  get explore(): boolean {
    return this.site === null;
  }
}

/** browser_click_next의 답: 이 러너가 누를 승인된 클릭 하나 */
export class ApprovedClick {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly taskId: string,
    readonly tabId: string,
    readonly pageUrl: string,
    readonly button: ButtonRef,
    readonly fingerprint: string,
  ) {}

  static from(click: Json): ApprovedClick {
    return new ApprovedClick(
      click.text('id'),
      click.number('version'),
      click.text('task_id'),
      click.text('tab_id'),
      click.text('page_url'),
      new ButtonRef(click.text('role'), click.text('name'), click.number('nth')),
      click.text('fingerprint'),
    );
  }
}
