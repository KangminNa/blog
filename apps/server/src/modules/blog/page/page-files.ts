import { RuleViolation } from '../../platform';

/** 판의 파일 하나 (blog.page_revisions.files의 원소). 파일 본문은 platform.blobs에 있다 */
export interface PageFileEntry {
  name: string;
  blobHash: string;
  mime: string;
  sizeBytes: number;
}

// 판 하나의 파일 묶음. 한 폴더에 나란히 있는 파일들이고(이름에 경로가 없다), 들어가는 문은 index.html이다.
// 보낼 때의 형식은 이름의 확장자로 정한다: 만든 쪽이 적은 형식을 믿지 않고, 모르는 확장자는 내려받는 파일로 둔다.
export class PageFiles {
  static readonly ENTRY = 'index.html';
  static readonly MAX = 100;
  /** 경로 없는 이름 (제어 문자 같은 것은 결과물을 받을 때 task가 이미 걸렀다) */
  private static readonly NAME = /^[^/\\]{1,120}$/;
  private static readonly HASH = /^[0-9a-f]{64}$/;
  private static readonly OCTET = 'application/octet-stream';
  private static readonly TYPES: Readonly<Record<string, string>> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    md: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    xml: 'application/xml; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
  };

  private constructor(private readonly entries: readonly PageFileEntry[]) {}

  /** 받은 목록(이벤트나 표의 files)에서. 모양이 틀리거나 index.html이 없으면 RuleViolation */
  static of(raw: unknown): PageFiles {
    if (!Array.isArray(raw) || raw.length === 0) throw new RuleViolation('페이지에 파일이 없어요');
    if (raw.length > PageFiles.MAX)
      throw new RuleViolation(`페이지의 파일은 ${PageFiles.MAX}개까지예요`);
    const entries = raw.map((item) => PageFiles.entry(item));
    const names = new Set(entries.map((e) => e.name));
    if (names.size !== entries.length) throw new RuleViolation('이름이 같은 파일이 있어요');
    if (!names.has(PageFiles.ENTRY)) throw new RuleViolation(`${PageFiles.ENTRY}이 없어요`);
    return new PageFiles(entries);
  }

  /** 이름으로 찾는다. 없으면 null */
  find(name: string): PageFileEntry | null {
    return this.entries.find((e) => e.name === name) ?? null;
  }

  /** 그 이름을 보낼 때의 형식 */
  static typeOf(name: string): string {
    const dot = name.lastIndexOf('.');
    const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
    return PageFiles.TYPES[extension] ?? PageFiles.OCTET;
  }

  /** 표에 넣을 모양 */
  toJSON(): readonly PageFileEntry[] {
    return this.entries;
  }

  private static entry(raw: unknown): PageFileEntry {
    const { name, blobHash, mime, sizeBytes } = (raw ?? {}) as Partial<PageFileEntry>;
    if (typeof name !== 'string' || !PageFiles.NAME.test(name) || name.startsWith('.'))
      throw new RuleViolation(`페이지 파일의 이름이 맞지 않아요: ${String(name)}`);
    if (typeof blobHash !== 'string' || !PageFiles.HASH.test(blobHash))
      throw new RuleViolation(`${name}: 파일 해시가 맞지 않아요`);
    if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0)
      throw new RuleViolation(`${name}: 크기가 맞지 않아요`);
    return { name, blobHash, mime: typeof mime === 'string' ? mime : PageFiles.OCTET, sizeBytes };
  }
}
