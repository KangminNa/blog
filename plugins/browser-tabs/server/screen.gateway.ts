import { lookup } from 'node:dns/promises';
import { BaseGateway } from '../../../apps/server/src/plugin-api';

// 서버 브라우저의 화면을 콘솔로 중계하는 길 (CDP, 2026-11-14). 영상 없이 HTTPS만으로 보고 누르고, 사이트 세션을 지운다.
// 브라우저 컨테이너 안의 중계(cdp-relay.py 9223 → Chrome 127.0.0.1:9222)는 서버와 브라우저만 붙는 망(browser)에서만 닿는다
// (docker-compose.browser.yml). Chrome은 Host가 이름이면 거절해서, 이름을 IP로 풀어 그 주소로 붙는다.
// 부를 때마다 탭 하나에 붙었다가 닫는다: 탭에 AI의 Playwright가 붙어 있어도 함께 붙을 수 있다.
// 입력한 글자(로그인의 비밀번호일 수 있다) · 주소 · 화면은 어디에도 남기지 않는다.

/** 탭 하나 (콘솔에 보이는 것) */
export type ScreenTab = { id: string; title: string; url: string };

/** 화면을 그린 결과: 탭 목록, 그린 탭, JPEG(base64), 그림이 덮는 화면의 크기(CSS 픽셀, 클릭 좌표의 기준) */
export type ScreenShot = {
  tabs: ScreenTab[];
  tab: string;
  image: string;
  width: number;
  height: number;
};

/** 화면에 보내는 동작. 좌표는 그림 위의 CSS 픽셀 */
export type ScreenAction =
  | { type: 'click'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; dy: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'activate' };

/** 보낼 수 있는 키 (키 이름 → Windows 키 코드 · 함께 들어가는 글자) */
const KEYS: Record<string, { code: number; text?: string }> = {
  Enter: { code: 13, text: '\r' },
  Tab: { code: 9 },
  Backspace: { code: 8 },
  Escape: { code: 27 },
  ArrowUp: { code: 38 },
  ArrowDown: { code: 40 },
  ArrowLeft: { code: 37 },
  ArrowRight: { code: 39 },
};

type Send = (method: string, params?: object) => Promise<Record<string, unknown>>;

export class BrowserScreenGateway extends BaseGateway {
  /** 보낼 수 있는 키 이름 (입력 검사가 쓴다) */
  static readonly KEY_NAMES: readonly string[] = Object.keys(KEYS);
  /** 탭 id의 모양 (Chrome은 32자리 16진수). 주소에 넣기 전에 본다 */
  static readonly TAB_ID = /^[A-Za-z0-9]{1,64}$/;
  /** 콘솔에 보여 줄 탭 수 */
  private static readonly TABS_MAX = 20;
  private static readonly JPEG_QUALITY = 60;
  /** 세션 지우기에서 지우는 저장소 (쿠키는 따로: 그 호스트로 가는 것만) */
  private static readonly STORAGE_TYPES =
    'local_storage,indexeddb,websql,cache_storage,service_workers,file_systems,shared_storage';

  protected readonly name = '서버 브라우저';
  protected override readonly timeoutMs = 8_000;

  constructor(
    /** 브라우저 중계의 이름 (compose 서비스 이름). 시험은 127.0.0.1 */
    private readonly host = 'browser',
    private readonly port = 9223,
  ) {
    super();
  }

  /** 탭을 하나 골라 화면을 그린다. 고른 탭이 없거나 닫혔으면 맨 앞 탭 */
  shot(wanted: string | null): Promise<ScreenShot> {
    return this.call(async (signal) => {
      const base = await this.base();
      const tabs = await this.tabs(base, signal);
      const tab = tabs.find((t) => t.id === wanted) ?? tabs[0];
      if (!tab) throw new Error('열린 탭이 없어요');
      return this.session(base, tab.id, signal, async (send) => {
        const metrics = await send('Page.getLayoutMetrics');
        const view = metrics.cssVisualViewport as {
          pageX?: number;
          pageY?: number;
          clientWidth: number;
          clientHeight: number;
        };
        // 보이는 자리만, CSS 픽셀 그대로 (스크롤 막대 · 화면 배율을 빼고): 그림 위 누른 자리가 그대로 클릭 좌표가 된다
        const picture = await send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: BrowserScreenGateway.JPEG_QUALITY,
          clip: {
            x: view.pageX ?? 0,
            y: view.pageY ?? 0,
            width: view.clientWidth,
            height: view.clientHeight,
            scale: 1,
          },
        });
        return {
          tabs,
          tab: tab.id,
          image: String(picture.data),
          width: Math.round(view.clientWidth),
          height: Math.round(view.clientHeight),
        };
      });
    });
  }

  /** 탭 하나에 동작을 보낸다 */
  control(tab: string, action: ScreenAction): Promise<void> {
    return this.call(async (signal) => {
      const base = await this.base();
      const tabs = await this.tabs(base, signal);
      if (!tabs.some((t) => t.id === tab)) throw new Error('닫힌 탭이에요');
      await this.session(base, tab, signal, (send) => BrowserScreenGateway.act(send, action));
    });
  }

  /**
   * 사이트 세션 지우기: 그 출처들의 호스트로 가는 쿠키(Network.deleteCookies)와 출처의 저장소(localStorage · IndexedDB …)만 지운다.
   * 쿠키만 지우면 토큰을 저장소에 두는 사이트는 로그인이 남는다. 다른 사이트의 로그인은 그대로다.
   * 로그인된 프로필(기본 컨텍스트)에서 하려고 빈 탭을 새로 열어 쓰고 닫는다 (/json/list의 탭은 둘러보기 컨텍스트일 수 있다).
   * 지운 쿠키 수를 돌려준다
   */
  clearSite(origins: readonly string[]): Promise<number> {
    const hosts = origins.map((o) => new URL(o).hostname);
    return this.call(async (signal) => {
      const base = await this.base();
      const res = await fetch(`http://${base}/json/new?about:blank`, { method: 'PUT', signal });
      const blank = res.ok ? ((await res.json()) as { id?: unknown }) : {};
      if (typeof blank.id !== 'string' || !BrowserScreenGateway.TAB_ID.test(blank.id))
        throw new Error(`빈 탭을 열지 못했어요 (${res.status})`);
      const tab = blank.id;
      try {
        return await this.session(base, tab, signal, async (send) => {
          const all = (await send('Network.getAllCookies')).cookies as {
            name: string;
            domain: string;
            path: string;
          }[];
          const mine = all.filter((c) =>
            hosts.some((h) => BrowserScreenGateway.sentTo(c.domain, h)),
          );
          for (const c of mine)
            await send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path });
          for (const origin of origins)
            await send('Storage.clearDataForOrigin', {
              origin,
              storageTypes: BrowserScreenGateway.STORAGE_TYPES,
            });
          return mine.length;
        });
      } finally {
        await fetch(`http://${base}/json/close/${tab}`).catch(() => undefined);
      }
    });
  }

  /** 쿠키의 도메인이 이 호스트로 가는가 (.example.com은 a.example.com에도) */
  private static sentTo(domain: string, host: string): boolean {
    const d = domain.replace(/^\./, '').toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  }

  private static async act(send: Send, action: ScreenAction): Promise<void> {
    switch (action.type) {
      case 'click': {
        const at = { x: action.x, y: action.y };
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
        const press = { ...at, button: 'left', clickCount: 1 };
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...press });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...press });
        return;
      }
      case 'scroll':
        await send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: action.x,
          y: action.y,
          deltaX: 0,
          deltaY: action.dy,
        });
        return;
      case 'text':
        await send('Input.insertText', { text: action.text });
        return;
      case 'key': {
        const key = KEYS[action.key];
        if (!key) throw new Error(`보낼 수 없는 키예요: ${action.key}`);
        const base = {
          key: action.key,
          code: action.key,
          windowsVirtualKeyCode: key.code,
          nativeVirtualKeyCode: key.code,
        };
        await send('Input.dispatchKeyEvent', {
          type: key.text ? 'keyDown' : 'rawKeyDown',
          ...base,
          ...(key.text ? { text: key.text } : {}),
        });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        return;
      }
      case 'navigate':
        await send('Page.navigate', { url: action.url });
        return;
      case 'back': {
        const history = await send('Page.getNavigationHistory');
        const index = Number(history.currentIndex);
        const entries = history.entries as { id: number }[];
        const previous = entries[index - 1];
        if (previous) await send('Page.navigateToHistoryEntry', { entryId: previous.id });
        return;
      }
      case 'activate':
        await send('Page.bringToFront');
        return;
    }
  }

  /** 중계의 주소. Chrome의 Host 검사를 지나려고 이름을 IP로 푼다 */
  private async base(): Promise<string> {
    try {
      const { address } = await lookup(this.host, { family: 4 });
      return `${address}:${this.port}`;
    } catch {
      throw new Error('서버 브라우저가 꺼져 있거나 이 서버와 같은 망에 없어요');
    }
  }

  private async tabs(base: string, signal: AbortSignal): Promise<ScreenTab[]> {
    const res = await fetch(`http://${base}/json/list`, { signal });
    if (!res.ok) throw new Error(`탭 목록을 받지 못했어요 (${res.status})`);
    const targets = (await res.json()) as {
      id?: unknown;
      type?: unknown;
      title?: unknown;
      url?: unknown;
    }[];
    return targets
      .filter((t) => t.type === 'page' && typeof t.id === 'string')
      .map((t) => ({ id: String(t.id), title: String(t.title ?? ''), url: String(t.url ?? '') }))
      .filter((t) => BrowserScreenGateway.TAB_ID.test(t.id) && !t.url.startsWith('devtools://'))
      .slice(0, BrowserScreenGateway.TABS_MAX);
  }

  /** 탭 하나에 CDP로 붙어 use를 돌리고 닫는다. 주소는 받은 값이 아니라 우리가 만든다 */
  private session<T>(
    base: string,
    tab: string,
    signal: AbortSignal,
    use: (send: Send) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = new WebSocket(`ws://${base}/devtools/page/${tab}`);
      const waiting = new Map<
        number,
        { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }
      >();
      let next = 0;
      const fail = (error: Error) => {
        for (const w of waiting.values()) w.fail(error);
        waiting.clear();
        reject(error);
        socket.close();
      };
      const send: Send = (method, params = {}) =>
        new Promise((ok, no) => {
          next += 1;
          waiting.set(next, { ok, fail: no });
          socket.send(JSON.stringify({ id: next, method, params }));
        });
      signal.addEventListener('abort', () => fail(new Error('시간이 지났어요')), { once: true });
      socket.onerror = () => fail(new Error('탭에 붙지 못했어요'));
      socket.onclose = () => fail(new Error('탭과의 연결이 끊겼어요'));
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: { message?: string };
        };
        const w = message.id === undefined ? undefined : waiting.get(message.id);
        if (!w || message.id === undefined) return;
        waiting.delete(message.id);
        if (message.error) w.fail(new Error(message.error.message ?? '브라우저가 거절했어요'));
        else w.ok(message.result ?? {});
      };
      socket.onopen = () => {
        use(send).then(
          (value) => {
            resolve(value);
            socket.close();
          },
          (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
        );
      };
    });
  }
}
