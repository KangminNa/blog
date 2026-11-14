import { createHash } from 'node:crypto';
import { pause } from './backoff';
import { BrowserUnavailable, DevToolsSession } from './browser-tabs';

/** 서버 브라우저의 탭 하나 (CDP 대상) */
export class BrowserTab {
  constructor(
    readonly id: string,
    readonly url: string,
    readonly title: string,
    readonly socket: string,
  ) {}
}

/** AI가 멈춘 마지막 버튼: 역할 · 이름 · 같은 것 가운데 몇 번째 (browser-stop.json) */
export class ButtonRef {
  constructor(
    readonly role: string,
    readonly name: string,
    readonly nth: number,
  ) {}
}

/** 러너가 다시 찾아 붙잡은 버튼: 결재 카드에 보이고, 누를 때 다시 맞춰 볼 지문 */
export class HeldButton {
  constructor(
    readonly tab: BrowserTab,
    readonly pageUrl: string,
    readonly button: ButtonRef,
    readonly box: { x: number; y: number; width: number; height: number },
    readonly fingerprint: string,
    /** 멈춘 화면 (JPEG base64) */
    readonly image: string,
  ) {}
}

/** 누른 결과: 눌렀다(clicked) 또는 달라서 누르지 않았다(changed), 그때의 주소 · 화면 */
export class PressResult {
  constructor(
    readonly outcome: 'clicked' | 'changed',
    readonly reason: string | null,
    readonly afterUrl: string | null,
    readonly image: string | null,
  ) {}
}

/** 버튼을 찾지 못하거나 누를 수 없는 상태 (페이지의 문제). 이유는 관리자에게 그대로 보인다 */
export class ButtonProblem extends Error {}

/** 버튼 요소에서 돌리는 확인: 보이는 자리로 옮기고, 자리 · 가장 위의 요소인지 · 켜져 있는지 · 지문의 재료 */
const INSPECT = `function () {
  this.scrollIntoView({ block: 'center', inline: 'center' });
  const r = this.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  const form = this.form || this.closest('form');
  const style = getComputedStyle(this);
  return {
    box: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    center: { x, y },
    onTop: top === this || this.contains(top),
    visible: r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
    enabled: !this.disabled && this.getAttribute('aria-disabled') !== 'true',
    tag: this.tagName.toLowerCase(),
    type: (this.getAttribute('type') || '').toLowerCase(),
    action: String((this.hasAttribute('formaction') && this.formAction) || this.href || (form && form.action) || ''),
    method: String((form && form.method) || '').toLowerCase(),
    text: String(this.innerText || this.value || '').trim().slice(0, 200),
  };
}`;

type Inspected = {
  box: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  onTop: boolean;
  visible: boolean;
  enabled: boolean;
  tag: string;
  type: string;
  action: string;
  method: string;
  text: string;
};

// 결재된 클릭의 브라우저 쪽 (2차 3단계, 2026-11-14). AI는 쓰지 않는다: 러너가 CDP로 직접 한다.
//   붙잡기(hold): AI가 남긴 역할 + 이름으로 접근성 트리(Accessibility.queryAXTree)에서 버튼을 다시 찾고, 보이고 · 켜져 있고 ·
//     한가운데의 가장 위 요소인지 본 뒤, 지문(주소 · 역할 · 이름 · 순번 · 태그 · type · form action · method · 글자의 sha256)과 화면을 만든다
//   누르기(press): 결재 뒤에 같은 탭 · 같은 주소 · 같은 지문 · 가장 위 요소인지 다시 보고, 같을 때만 실제 마우스 이벤트로 누른다.
//     다르면 누르지 않는다 (changed). 누른 뒤 뜰 때까지(최대 10초) 기다려 결과 화면을 남긴다
// Playwright의 ref는 그 MCP 세션 안에서만 뜻이 있어 쓰지 않는다. 역할 + 이름은 러너가 다시 찾을 수 있다.
export class BrowserPages {
  /** 화면 하나의 크기 (서버의 shots와 같다) */
  static readonly SHOT_MAX = 300 * 1024;
  /** 누른 뒤 새 페이지가 뜨기를 기다리는 시간 */
  static readonly LOAD_MS = 10_000;
  /** 누른 뒤 화면이 바뀌기를 기다리는 시간 (주소가 바뀌지 않는 페이지) */
  static readonly SETTLE_MS = 1_000;
  private static readonly QUALITIES = [70, 45, 25];

  constructor(
    /** CDP 주소 (예: http://127.0.0.1:9222) */
    private readonly endpoint: string,
  ) {}

  /** 열린 탭 (페이지만) */
  async tabs(signal: AbortSignal): Promise<BrowserTab[]> {
    const listed = await this.get('/json/list', signal);
    return (
      listed as {
        id?: unknown;
        type?: unknown;
        url?: unknown;
        title?: unknown;
        webSocketDebuggerUrl?: unknown;
      }[]
    )
      .filter(
        (t) =>
          t.type === 'page' &&
          typeof t.id === 'string' &&
          typeof t.webSocketDebuggerUrl === 'string',
      )
      .map(
        (t) =>
          new BrowserTab(
            String(t.id),
            String(t.url ?? ''),
            String(t.title ?? ''),
            String(t.webSocketDebuggerUrl),
          ),
      );
  }

  /** 주소를 새 탭으로 연다 (로그인된 프로필). 다 뜨기를 기다리지 않는다 */
  async open(url: string, signal: AbortSignal): Promise<BrowserTab> {
    const made = (await this.get(`/json/new?${url}`, signal, 'PUT')) as {
      id?: string;
      webSocketDebuggerUrl?: string;
    };
    if (!made.id || !made.webSocketDebuggerUrl)
      throw new BrowserUnavailable('새 탭을 열지 못했어요');
    return new BrowserTab(made.id, url, '', made.webSocketDebuggerUrl);
  }

  /** 탭의 지금 화면 (JPEG base64, 300KB 안). 찍지 못하면 null */
  async shot(tab: BrowserTab, signal: AbortSignal): Promise<string | null> {
    return this.on(tab, signal, (s) => BrowserPages.capture(s)).catch(() => null);
  }

  /** AI가 멈춘 버튼을 다시 찾아 붙잡을 것을 만든다. 찾지 못하거나 누를 수 없는 상태면 ButtonProblem */
  async hold(tab: BrowserTab, button: ButtonRef, signal: AbortSignal): Promise<HeldButton> {
    return this.on(tab, signal, async (s) => {
      await s.send('Page.bringToFront');
      const pageUrl = await BrowserPages.locationOf(s);
      const found = await BrowserPages.find(s, button);
      if (found === null) throw new ButtonProblem(`버튼이 없어요: ${button.role} "${button.name}"`);
      const problem = BrowserPages.unusable(found);
      if (problem) throw new ButtonProblem(problem);
      const image = await BrowserPages.capture(s);
      if (image === null) throw new ButtonProblem('멈춘 화면을 찍지 못했어요');
      const fingerprint = BrowserPages.fingerprint(pageUrl, button, found);
      return new HeldButton(tab, pageUrl, button, found.box, fingerprint, image);
    });
  }

  /**
   * 승인된 클릭: 같은 탭 · 같은 주소 · 같은 지문 · 가장 위 요소일 때만 누른다. 다르면 누르지 않고 그때의 화면과 까닭을 남긴다.
   * 브라우저에 닿지 못하면(누르기 전) 누르지 않는다 (changed)
   */
  async press(
    held: { tabId: string; pageUrl: string; button: ButtonRef; fingerprint: string },
    signal: AbortSignal,
  ): Promise<PressResult> {
    const changed = (reason: string, image: string | null = null, url: string | null = null) =>
      new PressResult('changed', reason, url, image);
    let tab: BrowserTab | undefined;
    try {
      tab = (await this.tabs(signal)).find((t) => t.id === held.tabId);
    } catch (error) {
      return changed(`브라우저에 닿지 못해 누르지 않았어요 (${(error as Error).message})`);
    }
    if (!tab) return changed('탭이 닫혔어요');
    const page = tab;
    try {
      return await this.on(page, signal, async (s) => {
        await s.send('Page.bringToFront');
        const url = await BrowserPages.locationOf(s);
        if (BrowserPages.withoutHash(url) !== BrowserPages.withoutHash(held.pageUrl))
          return changed('주소가 달라요', await BrowserPages.capture(s), url);
        const found = await BrowserPages.find(s, held.button);
        if (found === null) return changed('버튼이 없어요', await BrowserPages.capture(s), url);
        if (BrowserPages.fingerprint(url, held.button, found) !== held.fingerprint)
          return changed('버튼이 달라요', await BrowserPages.capture(s), url);
        const problem = BrowserPages.unusable(found);
        if (problem) return changed(problem, await BrowserPages.capture(s), url);
        await s.send('Page.enable');
        const started = s.next('Page.frameStartedLoading').then(() => true);
        const loaded = s.next('Page.loadEventFired');
        await BrowserPages.click(s, found.center);
        // 새 페이지로 가면 다 뜰 때까지, 아니면 화면이 바뀔 짧은 동안만 기다린다
        const moving = await Promise.race([
          started,
          pause(BrowserPages.SETTLE_MS, signal).then(() => false),
        ]);
        if (moving) await Promise.race([loaded, pause(BrowserPages.LOAD_MS, signal)]);
        const image = await BrowserPages.capture(s).catch(() => null);
        const after = await BrowserPages.locationOf(s).catch(() => null);
        return new PressResult('clicked', image ? null : '결과 화면 없음', after, image);
      });
    } catch (error) {
      if (error instanceof ButtonProblem) return changed(error.message);
      return changed(`브라우저에 닿지 못해 누르지 않았어요 (${(error as Error).message})`);
    }
  }

  /** 지문의 재료를 sha256으로. 주소는 # 뒤를 뺀다 */
  static fingerprint(
    url: string,
    button: ButtonRef,
    found: Pick<Inspected, 'tag' | 'type' | 'action' | 'method' | 'text'>,
  ): string {
    const parts = [
      BrowserPages.withoutHash(url),
      button.role,
      button.name,
      button.nth,
      found.tag,
      found.type,
      found.action,
      found.method,
      found.text,
    ];
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  }

  static withoutHash(url: string): string {
    return url.split('#')[0] ?? url;
  }

  /** 접근성 트리에서 역할 + 이름이 같은 nth번째 노드를 찾아 확인한다. 없으면 null */
  private static async find(s: DevToolsSession, button: ButtonRef): Promise<Inspected | null> {
    const doc = (await s.send('DOM.getDocument', { depth: 0 })).root as { nodeId: number };
    const tree = await s.send('Accessibility.queryAXTree', {
      nodeId: doc.nodeId,
      accessibleName: button.name,
      role: button.role,
    });
    const nodes = ((tree.nodes ?? []) as { ignored?: boolean; backendDOMNodeId?: number }[]).filter(
      (n) => !n.ignored && typeof n.backendDOMNodeId === 'number',
    );
    const node = nodes[button.nth];
    if (!node) return null;
    const resolved = await s.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
    const objectId = (resolved.object as { objectId?: string } | undefined)?.objectId;
    if (!objectId) return null;
    const inspected = await s.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: INSPECT,
      returnByValue: true,
    });
    return ((inspected.result as { value?: Inspected } | undefined)?.value ??
      null) as Inspected | null;
  }

  /** 누를 수 없는 까닭. 누를 수 있으면 null */
  private static unusable(found: Inspected): string | null {
    if (!found.visible) return '버튼이 보이지 않아요';
    if (!found.enabled) return '버튼이 꺼져 있어요';
    if (!found.onTop) return '버튼이 다른 것에 가려져 있어요';
    return null;
  }

  /** 실제 마우스 이벤트로 누른다 (옮기고 · 누르고 · 떼고) */
  private static async click(s: DevToolsSession, at: { x: number; y: number }): Promise<void> {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    const press = { x: at.x, y: at.y, button: 'left', clickCount: 1 };
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press });
  }

  private static async locationOf(s: DevToolsSession): Promise<string> {
    const read = await s.send('Runtime.evaluate', {
      expression: 'location.href',
      returnByValue: true,
    });
    return String((read.result as { value?: unknown } | undefined)?.value ?? '');
  }

  /** 보이는 화면을 JPEG로. 300KB를 넘으면 질을 낮춰 다시. 끝내 넘으면 null */
  private static async capture(s: DevToolsSession): Promise<string | null> {
    for (const quality of BrowserPages.QUALITIES) {
      const shot = await s.send('Page.captureScreenshot', { format: 'jpeg', quality });
      const data = String(shot.data ?? '');
      if (data && Buffer.byteLength(data, 'base64') <= BrowserPages.SHOT_MAX) return data;
    }
    return null;
  }

  /** 탭 하나에 CDP로 붙어 use를 돌리고 닫는다 */
  private async on<T>(
    tab: BrowserTab,
    signal: AbortSignal,
    use: (s: DevToolsSession) => Promise<T>,
  ): Promise<T> {
    const session = await DevToolsSession.open(tab.socket, signal);
    try {
      return await use(session);
    } finally {
      session.close();
    }
  }

  private async get(path: string, signal: AbortSignal, method = 'GET'): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}${path}`, { method, signal });
    } catch (error) {
      throw new BrowserUnavailable(
        `브라우저(${this.endpoint})에 닿지 못했어요: ${(error as Error).message}`,
      );
    }
    if (!res.ok) throw new BrowserUnavailable(`브라우저가 거절했어요 (${res.status})`);
    return res.json();
  }
}
