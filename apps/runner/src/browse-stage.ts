import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pause } from './backoff';
import type { BrowseJob, BrowseSite } from './browse-job';
import { BrowsePlan } from './browser-mcp';
import { BrowserPages, type BrowserTab, ButtonProblem, type HeldButton } from './browser-page';
import type { BrowserSlot } from './browser-slot';
import { BrowserStop, BrowserStopProblem } from './browser-stop';
import { BrowserUnavailable, TabUnreadable } from './browser-tabs';
import { CairnServer } from './cairn-server';
import { ExploreProxy } from './explore-proxy';
import type { Job } from './job';
import { RunEnding } from './job-run';
import { McpClient, ServerUnreachable, ToolRefused } from './mcp-client';
import { RunEvent, RunResult } from './progress';
import type { PromptPack } from './prompt-pack';
import type { Redactor } from './redactor';
import type { RunnerConfig } from './runner-config';
import type { SandboxStage } from './sandbox-stage';

/** 러너가 올릴 결재 하나 (작업 토큰으로, 에이전트의 이름으로) */
type AskedApproval = {
  requestId: string;
  action: string;
  targetKind: string;
  targetId: string;
  targetVersion: number;
  note: string;
};

type Note = (event: RunEvent) => void;

// 브라우저 작업(browse)의 앞뒤 (2차 3단계 서버 브라우저 목표, 2026-11-14). AI는 Playwright MCP로 채우기까지만 하고,
// 마지막 버튼 · 로그인은 러너(AI 없음)가 한다.
//   앞: browser_job으로 어디서 돌지 받는다. 둘러보기면 내부 주소를 막는 프록시를 띄우고(ExploreProxy) 여럿이 함께 돈다.
//       사이트 일이면 브라우저 자리(BrowserSlot)를 잡고 지금 탭을 기억한다. 로그인이 필요하다고 적혀 있으면 AI 없이 로그인 결재로
//   뒤: AI가 단계마다 찍은 화면을 올린다(browser_shot_save). browser-stop.json이 있으면
//       final_click → 그 탭에서 버튼을 다시 찾아 지문 · 화면과 함께 붙잡고(browser_click_hold) 클릭 결재를 올린다
//       login → 로그인 화면을 남기고(browser_login_needed) 로그인 결재를 올린다 ("로그인했어요"면 같은 작업이 처음부터 이어서)
// 결재는 AI가 아니라 러너가 올린다: 지문과 화면이 있어야 승인 뒤에 "같은 버튼"을 확인할 수 있다 (ClickRunner가 누른다).
export class BrowseStage implements SandboxStage {
  static readonly PUBLISH_ACTION = 'browser.site.publish';
  static readonly LOGIN_ACTION = 'browser.site.login';
  /** 탭을 새로 열고 로그인 화면이 그려지기를 기다리는 시간 */
  private static readonly OPEN_MS = 2_000;
  private static readonly STEP_FILE = /\.(jpe?g|png)$/i;
  private static readonly STOPPING = '러너가 멈춰요';

  readonly workspaceRoom = null;
  readonly needsOutputs = false;
  unreachable = false;
  private plan: BrowseJob | null = null;
  /** 이 일의 자리 (단계 화면 폴더) */
  private dir: string | null = null;
  private proxy: ExploreProxy | null = null;
  /** 잡은 브라우저 자리를 놓는다 (사이트 일만) */
  private free: (() => void) | null = null;
  /** AI가 뜨기 전에 열려 있던 탭: AI가 새로 연 탭을 먼저 본다 */
  private before = new Set<string>();
  private approval: AskedApproval | null = null;

  constructor(
    private readonly job: Job,
    private readonly config: RunnerConfig,
    private readonly server: CairnServer,
    private readonly slot: BrowserSlot,
    private readonly pages: BrowserPages,
  ) {}

  /** 결과 뒤에 올릴 결재가 있는가 (클릭 · 로그인) */
  get awaitsApproval(): boolean {
    return this.approval !== null;
  }

  async prepare(signal: AbortSignal, note: Note, redactor: Redactor): Promise<RunEnding | null> {
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    try {
      this.plan = await this.server.browserJob(this.job.taskId, signal);
    } catch (error) {
      if (signal.aborted) return RunEnding.release(BrowseStage.STOPPING);
      if (error instanceof ToolRefused)
        return failed(`어디서 일할지 받지 못했어요: ${error.message}`);
      if (!(error instanceof ServerUnreachable)) throw error;
      this.unreachable = true;
      return RunEnding.release(`서버에 닿지 못해 돌려줘요: ${error.message}`);
    }
    this.dir = await mkdtemp(join(await realpath(tmpdir()), 'cairn-browse-'));
    await mkdir(join(this.dir, 'steps'));
    const { site } = this.plan;
    if (site === null) {
      this.proxy = await ExploreProxy.start();
      note(
        new RunEvent(
          RunEvent.READ,
          '둘러보기: 로그인 없는 새 창으로 열어요 (내부 주소는 막혀요)',
          0,
        ),
      );
      return null;
    }
    this.free = await this.slot.take(signal);
    if (this.free === null) return RunEnding.release(BrowseStage.STOPPING);
    note(new RunEvent(RunEvent.READ, `사이트: ${site.name}`, 0));
    try {
      const tabs = await this.pages.tabs(signal);
      this.before = new Set(tabs.map((t) => t.id));
      if (!this.plan.loginNeeded) return null;
      // 로그인이 풀려 있다고 적혀 있다: AI를 띄우지 않고 로그인 결재를 바로 올린다 (관리자가 로그인할 탭을 열어 둔다)
      const tab = await this.loginTab(site, tabs, signal);
      const url = tab.url || site.startUrl;
      const ending = await this.needLogin(site, url, tab, signal, note, redactor);
      const asked = ending ?? (await this.requestApproval(signal, redactor));
      return asked ?? RunEnding.quiet('로그인이 필요해 결재를 올렸어요');
    } catch (error) {
      if (!(error instanceof BrowserUnavailable)) throw error;
      this.unreachable = true;
      return RunEnding.release(`브라우저에 닿지 못해 돌려줘요: ${error.message}`);
    }
  }

  /** AI에게 줄 일: 사이트 · 둘러보기 단락(지시문 틀 site)과 Playwright MCP를 띄울 자리 */
  aiJob(prompts: PromptPack): Job {
    const { plan, dir } = this;
    if (plan === null || dir === null) return this.job;
    const site = plan.site;
    const part = prompts.fill('site', {
      explore: site === null,
      name: site?.name ?? null,
      start: site?.startUrl ?? null,
      origins: site?.origins.join(', ') ?? null,
      held: plan.held?.pageUrl ?? null,
    });
    const browse = new BrowsePlan(site?.origins ?? [], join(dir, 'steps'), this.proxy?.url ?? null);
    return this.job.withBrowse(browse, part);
  }

  async finish(
    summary: string,
    signal: AbortSignal,
    note: Note,
    redactor: Redactor,
    workDir = '',
  ): Promise<RunEnding> {
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    await this.shipSteps(signal, note);
    const done = RunEnding.submit('끝났어요', RunResult.done(summary, redactor));
    let stop: BrowserStop | null;
    try {
      stop = await BrowserStop.read(join(workDir, BrowserStop.FILE));
    } catch (error) {
      if (error instanceof BrowserStopProblem)
        return failed(`멈춘 자리를 읽지 못했어요: ${error.message}`);
      throw error;
    }
    const site = this.plan?.site ?? null;
    if (stop === null) return done;
    if (site === null) {
      note(
        new RunEvent(
          RunEvent.ERROR,
          '둘러보기에서는 누르거나 로그인하지 않아요 (멈춘 자리는 두고 끝내요)',
          0,
        ),
      );
      return done;
    }
    const tab = await this.tabOf(stop.pageUrl, signal);
    if (stop.kind === 'login')
      return (await this.needLogin(site, stop.pageUrl, tab, signal, note, redactor)) ?? done;
    if (tab === null) return failed('멈춘 페이지의 탭을 찾지 못했어요');
    let held: HeldButton;
    try {
      held = await this.pages.hold(tab, stop.button as NonNullable<BrowserStop['button']>, signal);
    } catch (error) {
      const known = [ButtonProblem, TabUnreadable, BrowserUnavailable].some(
        (t) => error instanceof t,
      );
      if (!known) throw error;
      return failed(`멈춘 버튼을 붙잡지 못했어요: ${(error as Error).message}`);
    }
    try {
      const click = await this.server.holdClick(this.job.taskId, held, stop.note);
      this.approval = {
        requestId: `browser-click:${click.clickId}`,
        action: BrowseStage.PUBLISH_ACTION,
        targetKind: 'browser_click',
        targetId: click.clickId,
        targetVersion: click.version,
        note: stop.note ?? `${held.button.role} "${held.button.name}" 앞에서 멈췄어요`,
      };
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      return failed(`버튼을 붙잡지 못했어요: ${error.message}`);
    }
    note(
      new RunEvent(
        RunEvent.WRITE,
        `마지막 버튼 앞에서 멈췄어요: ${held.button.name} (${BrowseStage.host(held.pageUrl)})`,
        0,
      ),
    );
    return done;
  }

  /** 붙잡은 클릭 · 로그인 필요의 결재를 작업 토큰으로 올린다. 올리면 null, 못 올리면 실패로 끝낼 그 끝 */
  async requestApproval(signal: AbortSignal, redactor: Redactor): Promise<RunEnding | null> {
    const asked = this.approval;
    if (asked === null || signal.aborted) return null;
    const failed = (error: string) => RunEnding.submit(error, RunResult.failed(error, redactor));
    if (!this.job.runToken) return failed('작업 토큰이 없어 결재를 올리지 못했어요');
    const asAgent = new CairnServer(new McpClient(this.config.mcpUrl, this.job.runToken));
    try {
      await asAgent.requestApproval(asked);
      return null;
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      const hint =
        error instanceof ToolRefused
          ? ` (에이전트의 결재 동작에 ${asked.action}가 있어야 해요)`
          : '';
      return failed(`결재를 올리지 못했어요: ${error.message}${hint}`);
    }
  }

  async close(): Promise<void> {
    this.free?.();
    this.free = null;
    await this.proxy?.close();
    this.proxy = null;
    if (this.dir) await rm(this.dir, { recursive: true, force: true });
  }

  /** 로그인 화면을 남기고 로그인 결재를 준비한다. 남기지 못하면 실패로 끝낼 그 끝 */
  private async needLogin(
    site: BrowseSite,
    url: string,
    tab: BrowserTab | null,
    signal: AbortSignal,
    note: Note,
    redactor: Redactor,
  ): Promise<RunEnding | null> {
    const image = tab ? await this.pages.shot(tab, signal) : null;
    try {
      const target = await this.server.loginNeeded(this.job.taskId, {
        url,
        title: tab?.title ?? '',
        image,
      });
      this.approval = {
        requestId: `browser-login:${randomUUID()}`,
        action: BrowseStage.LOGIN_ACTION,
        targetKind: 'browser_site',
        targetId: target.siteId,
        targetVersion: target.siteVersion,
        note: `로그인 필요: ${site.name}. 브라우저 화면에서 로그인한 뒤 "로그인했어요"를 눌러 주세요`,
      };
    } catch (error) {
      if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
      const message = `로그인 필요를 남기지 못했어요: ${error.message}`;
      return RunEnding.submit(message, RunResult.failed(message, redactor));
    }
    note(new RunEvent(RunEvent.WRITE, `로그인이 필요해요: ${site.name}`, 0));
    return null;
  }

  /** 관리자가 로그인할 탭: 사이트의 탭이 있으면 그것, 없으면 시작 주소를 새 탭으로 열고 잠깐 기다린다 */
  private async loginTab(
    site: BrowseSite,
    tabs: BrowserTab[],
    signal: AbortSignal,
  ): Promise<BrowserTab> {
    const open = tabs.find((t) => BrowseStage.within(t.url, site));
    if (open) return open;
    const made = await this.pages.open(site.startUrl, signal);
    await pause(BrowseStage.OPEN_MS, signal);
    return made;
  }

  /** 멈춘 주소의 탭. AI가 새로 연 탭을 먼저, 없으면 같은 주소의 탭, 그래도 없고 새 탭이 하나뿐이면 그 탭 */
  private async tabOf(url: string, signal: AbortSignal): Promise<BrowserTab | null> {
    const tabs = await this.pages.tabs(signal).catch(() => []);
    const want = BrowserPages.withoutHash(url);
    const same = (t: BrowserTab) => BrowserPages.withoutHash(t.url) === want;
    const fresh = tabs.filter((t) => !this.before.has(t.id));
    return fresh.find(same) ?? tabs.find(same) ?? (fresh.length === 1 ? (fresh[0] ?? null) : null);
  }

  /** AI가 단계마다 찍은 화면(--output-dir)을 찍은 차례대로 올린다. 300KB를 넘거나 서버가 받지 않으면 실행 기록에 한 줄 */
  private async shipSteps(signal: AbortSignal, note: Note): Promise<void> {
    if (this.dir === null) return;
    const steps = join(this.dir, 'steps');
    const names = (await readdir(steps).catch(() => [] as string[])).filter((n) =>
      BrowseStage.STEP_FILE.test(n),
    );
    const files = await Promise.all(
      names.map(async (name) => ({ name, info: await stat(join(steps, name)) })),
    );
    files.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs);
    let sent = 0;
    for (const { name, info } of files) {
      if (signal.aborted) return;
      if (info.size > BrowserPages.SHOT_MAX) {
        note(new RunEvent(RunEvent.ERROR, `단계 화면이 300KB를 넘어 올리지 않았어요: ${name}`, 0));
        continue;
      }
      try {
        const image = (await readFile(join(steps, name))).toString('base64');
        await this.server.saveShot(this.job.taskId, { url: '', title: name, image });
        sent++;
      } catch (error) {
        if (!(error instanceof ToolRefused || error instanceof ServerUnreachable)) throw error;
        note(new RunEvent(RunEvent.ERROR, `단계 화면을 더 올리지 못했어요: ${error.message}`, 0));
        break;
      }
    }
    if (sent > 0) note(new RunEvent(RunEvent.WRITE, `단계 화면 ${sent}장을 남겼어요`, 0));
  }

  /** 주소가 사이트의 허용 출처 안인가 */
  private static within(url: string, site: BrowseSite): boolean {
    return URL.canParse(url) && site.origins.includes(new URL(url).origin);
  }

  private static host(url: string): string {
    return URL.canParse(url) ? new URL(url).host : '';
  }
}
