import { Backoff, pause } from './backoff';
import { type BrowserTabs, BrowserUnavailable, TabUnreadable } from './browser-tabs';
import type { CairnServer } from './cairn-server';
import { AccessDenied, ToolRefused } from './mcp-client';
import type { RunLog } from './redactor';

// browser-tabs 패키지의 러너 쪽. 브라우저(CAIRN_BROWSER_URL)가 있는 러너만 돈다.
// 읽어 달라는 주소를 받아(browser_tab_pending) 브라우저 탭으로 열어 읽고 남긴다(browser_tab_save).
// 작업 대기열(next_jobs)과 따로 돈다: 탭 읽기는 AI를 부르지 않아 일과 한도를 나눠 쓰지 않는다.
// 로그에는 요청 id와 주소의 호스트만 남긴다 (경로 · 내용은 남기지 않는다).
export class TabReader {
  /** 읽을 것이 없을 때 다시 묻는 간격 */
  static readonly IDLE_MS = 15_000;
  /** 패키지가 꺼져 있을 때 (도구가 없을 때) 다시 묻는 간격 */
  static readonly OFF_MS = 300_000;
  private readonly backoff = new Backoff(5_000, 300_000);
  private off = false;

  constructor(
    private readonly server: CairnServer,
    private readonly browser: BrowserTabs,
    private readonly log: RunLog,
  ) {}

  /** stop까지 돈다. 토큰이 거절되면 AccessDenied를 그대로 던진다 (러너가 다시 연결한다) */
  async run(stop: AbortSignal): Promise<void> {
    this.log.info('브라우저 탭 읽기를 켰어요');
    while (!stop.aborted) {
      try {
        const asked = await this.server.pendingTabs(stop);
        if (this.off) this.log.info('브라우저 탭 패키지가 켜져 있어요. 읽기를 시작해요');
        this.off = false;
        this.backoff.reset();
        for (const tab of asked) await this.readOne(tab.id, tab.url, stop);
        if (asked.length === 0) await pause(TabReader.IDLE_MS, stop);
      } catch (error) {
        if (stop.aborted) break;
        if (error instanceof AccessDenied) throw error;
        if (error instanceof ToolRefused && /도구가 없어요/.test(error.message)) {
          if (!this.off)
            this.log.info('브라우저 탭 패키지가 꺼져 있어요. 플러그인에서 켜면 읽어요');
          this.off = true;
          await pause(TabReader.OFF_MS, stop);
          continue;
        }
        // 브라우저가 없는 동안은 읽어 달라는 주소를 실패로 남기지 않는다: 요청은 그대로 두고 다시 묻는다
        const why = error instanceof BrowserUnavailable ? '브라우저를 기다려요' : '다시 시도해요';
        this.log.info(`브라우저 탭: ${why}: ${(error as Error).message}`);
        await this.backoff.wait(stop);
      }
    }
  }

  /**
   * 하나를 읽어 남긴다. 페이지를 읽지 못했으면 그 이유를 남긴다 (같은 주소를 계속 다시 열지 않게).
   * 브라우저에 닿지 못하면(BrowserUnavailable) 남기지 않고 그대로 던져 run이 기다렸다 다시 한다
   */
  private async readOne(id: string, url: string, stop: AbortSignal): Promise<void> {
    const host = TabReader.hostOf(url);
    try {
      const text = await this.browser.read(url, stop);
      await this.server.saveTab(id, { title: text.title, body: text.body });
      this.log.info(`브라우저 탭을 읽었어요: ${host} (${text.body.length}자)`);
    } catch (error) {
      if (stop.aborted || !(error instanceof TabUnreadable)) throw error;
      await this.server.saveTab(id, { error: error.message });
      this.log.info(`브라우저 탭을 읽지 못했어요: ${host} — ${error.message}`);
    }
  }

  private static hostOf(url: string): string {
    return URL.canParse(url) ? new URL(url).host : '(주소 아님)';
  }
}
