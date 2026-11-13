// 받은 HTML을 AI가 읽을 글자로 (read_url). 그리지 않고 글자만 남긴다: 스크립트 · 스타일 · 그림은 버리고
// 문단 · 줄 바꿈만 살린다. 라이브러리 없이 하는 만큼이라 모양이 복잡한 페이지는 글자가 섞일 수 있다.
// biome-ignore lint/complexity/noStaticOnlyClass: 글자 바꾸기 묶음. 상태가 없다 (FileSniff와 같은 모양)
export class HtmlText {
  /** 통째로 버리는 덩어리 */
  private static readonly DROP =
    /<(script|style|noscript|svg|template|iframe|object|canvas|head|title)\b[\s\S]*?<\/\1\s*>/gi;
  /** 닫히면 줄을 바꾸는 태그 */
  private static readonly BREAK =
    /<\/?(p|div|section|article|header|footer|main|aside|nav|li|ul|ol|tr|table|h[1-6]|br|hr|blockquote|pre|dd|dt|figcaption)\b[^>]*>/gi;
  private static readonly NAMED: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    middot: '·',
    hellip: '…',
    ndash: '–',
    mdash: '—',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    copy: '©',
  };

  /** <title>의 글자 (없으면 빈 글자) */
  static title(html: string): string {
    const found = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return found
      ? HtmlText.decode((found[1] ?? '').replace(/<[^>]+>/g, ''))
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  }

  /** 본문 글자. 빈 줄은 하나로 줄인다 */
  static body(html: string): string {
    const text = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(HtmlText.DROP, '')
      .replace(HtmlText.BREAK, '\n')
      .replace(/<[^>]+>/g, '');
    return HtmlText.decode(text)
      .replace(/[ \t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** HTML 앞부분의 <meta charset> (머리글에 없을 때) */
  static metaCharset(head: string): string | null {
    const found = /<meta[^>]+charset=["']?\s*([\w-]+)/i.exec(head);
    return found?.[1]?.toLowerCase() ?? null;
  }

  private static decode(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n =
          code[1] === 'x' || code[1] === 'X'
            ? Number.parseInt(code.slice(2), 16)
            : Number(code.slice(1));
        return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return HtmlText.NAMED[code.toLowerCase()] ?? whole;
    });
  }
}
