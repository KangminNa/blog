import { lstat, readFile } from 'node:fs/promises';
import { ButtonRef } from './browser-page';

/** 멈춘 자리를 읽지 못함 (모양이 틀림). 누를 것을 붙잡지 않는다 */
export class BrowserStopProblem extends Error {}

// AI가 멈춘 자리 (cairn-browse 스킬). AI는 결재를 올리지 않고 작업 폴더에 browser-stop.json을 쓰고 끝낸다:
//   { "stop": "final_click", "page_url": "...", "button": { "role": "button", "name": "게시", "nth": 0 }, "note": "..." }
//   { "stop": "login", "page_url": "..." }
// 러너(AI 없음)가 읽어 버튼을 다시 찾아 붙잡거나(결재된 클릭) 로그인 필요 결재를 올린다. 믿지 않는 입력이라 모양을 본다.
export class BrowserStop {
  static readonly FILE = 'browser-stop.json';
  private static readonly SIZE_MAX = 10_000;
  private static readonly ROLE = /^[a-z]{1,40}$/;

  private constructor(
    /** final_click · login */
    readonly kind: 'final_click' | 'login',
    readonly pageUrl: string,
    /** 마지막 버튼 (final_click만) */
    readonly button: ButtonRef | null,
    readonly note: string | null,
  ) {}

  /** 파일을 읽는다. 없으면 null (AI가 멈추지 않고 끝냈다). 링크 · 큰 파일 · 틀린 모양은 BrowserStopProblem */
  static async read(path: string): Promise<BrowserStop | null> {
    const info = await lstat(path).catch(() => null);
    if (info === null) return null;
    if (!info.isFile() || info.size > BrowserStop.SIZE_MAX)
      throw new BrowserStopProblem(`${BrowserStop.FILE}가 보통 파일이 아니거나 너무 커요`);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      throw new BrowserStopProblem(`${BrowserStop.FILE}가 JSON이 아니에요`);
    }
    return BrowserStop.of(raw);
  }

  static of(raw: unknown): BrowserStop {
    const r = (raw ?? {}) as Record<string, unknown>;
    const url = typeof r.page_url === 'string' ? r.page_url.trim() : '';
    if (!/^https?:\/\//i.test(url) || url.length > 2000 || !URL.canParse(url))
      throw new BrowserStopProblem('page_url은 http · https 주소여야 해요');
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 500) : null;
    if (r.stop === 'login') return new BrowserStop('login', url, null, note);
    if (r.stop !== 'final_click')
      throw new BrowserStopProblem('stop은 final_click · login 중 하나예요');
    const b = (r.button ?? {}) as Record<string, unknown>;
    const role = typeof b.role === 'string' ? b.role.trim().toLowerCase() : '';
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const nth = b.nth === undefined ? 0 : b.nth;
    if (!BrowserStop.ROLE.test(role))
      throw new BrowserStopProblem('button.role은 button · link 같은 역할이에요');
    if (name.length === 0 || name.length > 200)
      throw new BrowserStopProblem('button.name은 1~200자예요');
    if (typeof nth !== 'number' || !Number.isInteger(nth) || nth < 0 || nth > 50)
      throw new BrowserStopProblem('button.nth는 0~50이에요');
    return new BrowserStop('final_click', url, new ButtonRef(role, name, nth), note);
  }
}
