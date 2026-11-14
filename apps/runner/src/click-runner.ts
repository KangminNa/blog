import { Backoff, pause } from './backoff';
import type { ApprovedClick } from './browse-job';
import type { BrowserPages } from './browser-page';
import type { BrowserSlot } from './browser-slot';
import type { CairnServer } from './cairn-server';
import { AccessDenied, ServerUnreachable, ToolRefused } from './mcp-client';
import type { RunLog } from './redactor';

// 결재된 클릭의 러너 쪽 (2차 3단계, 2026-11-14). 서버 브라우저가 있는 서버 러너만 돈다. 작업 대기열과 따로 돈다:
// 승인된 클릭은 임대가 없다 (작업은 결과를 기다린다). 이 러너가 붙잡은 클릭만 browser_click_next로 받는다.
// 브라우저 자리(BrowserSlot)를 잡고, 같은 탭 · 주소 · 지문인지 다시 본 뒤에만 누르고(BrowserPages.press) 결과를 남긴다.
// 다르면 누르지 않는다 (changed: 작업은 실패로 끝나고 관리자가 콘솔 화면에서 직접 한다). 많아야 한 번 누른다:
// 누르는 중에 러너가 멈추면 서버가 2분 뒤 unknown으로 닫고 다시 누르지 않는다. 로그에는 클릭 id와 호스트만 남긴다.
export class ClickRunner {
  /** 누를 것이 없을 때 다시 묻는 간격 */
  static readonly IDLE_MS = 5_000;
  /** 패키지가 꺼져 있을 때 (도구가 없을 때) 다시 묻는 간격 */
  static readonly OFF_MS = 300_000;
  /** 결과를 남기지 못했을 때 다시 보내는 횟수 (넘으면 서버가 2분 뒤 unknown으로 닫는다) */
  private static readonly SAVE_TRIES = 5;
  private readonly backoff = new Backoff(5_000, 300_000);
  private off = false;

  constructor(
    private readonly server: CairnServer,
    private readonly pages: BrowserPages,
    private readonly slot: BrowserSlot,
    private readonly log: RunLog,
  ) {}

  /** stop까지 돈다. 토큰이 거절되면 AccessDenied를 그대로 던진다 (러너가 다시 연결한다) */
  async run(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) {
      try {
        const click = await this.server.nextClick(stop);
        if (this.off) this.log.info('결재된 클릭을 다시 받아요');
        this.off = false;
        this.backoff.reset();
        if (click) await this.press(click, stop);
        else await pause(ClickRunner.IDLE_MS, stop);
      } catch (error) {
        if (stop.aborted) break;
        if (error instanceof AccessDenied) throw error;
        if (error instanceof ToolRefused && /도구가 없어요/.test(error.message)) {
          if (!this.off) this.log.info('브라우저 탭 패키지가 꺼져 있어 결재된 클릭을 받지 않아요');
          this.off = true;
          await pause(ClickRunner.OFF_MS, stop);
          continue;
        }
        this.log.info(`결재된 클릭: 다시 시도해요: ${(error as Error).message}`);
        await this.backoff.wait(stop);
      }
    }
  }

  /** 자리를 잡고 다시 확인한 뒤 누르고, 결과를 남긴다 */
  private async press(click: ApprovedClick, stop: AbortSignal): Promise<void> {
    const free = await this.slot.take(stop);
    if (free === null) return;
    let result: Awaited<ReturnType<BrowserPages['press']>>;
    try {
      result = await this.pages.press(click, stop);
    } finally {
      free();
    }
    const host = URL.canParse(click.pageUrl) ? new URL(click.pageUrl).host : '';
    this.log.info(
      result.outcome === 'clicked'
        ? `결재된 클릭을 눌렀어요: ${click.id} (${host})`
        : `결재된 클릭을 누르지 않았어요: ${click.id} (${host}) — ${result.reason}`,
    );
    for (let tries = 1; ; tries++) {
      try {
        await this.server.saveClick(click, result);
        return;
      } catch (error) {
        if (
          !(error instanceof ServerUnreachable) ||
          tries >= ClickRunner.SAVE_TRIES ||
          stop.aborted
        )
          throw error;
        await this.backoff.wait(stop);
      }
    }
  }
}
