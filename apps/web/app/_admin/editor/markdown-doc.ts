import { renderMarkdown } from '../../_lib/markdown';

// 편집기 문서 ↔ 글 본문 md. 저장은 md 그대로 (백업·옵시디언·AI 도구가 읽는 모양, 기획서 2026-10-24).
//   불러오기: md → HTML(방문자 화면과 같은 변환) → 편집기. 가운데 블록은 문단마다 가운데 정렬로 푼다
//   저장하기: 편집기 문서 → md. 이어진 가운데 문단은 ::: center 블록 하나로 묶는다
// 빈 줄을 띄우려고 넣은 빈 문단은 줄바꿈 없는 빈칸(U+00A0) 문단으로 남긴다 (md에서는 빈 줄이 합쳐지므로).

/** 편집기 문서의 마디 (Tiptap getJSON의 모양 중 여기서 쓰는 것) */
export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
};

type DocMark = { type: string; attrs?: Record<string, unknown> };

const NBSP = ' ';

/** md → 편집기에 넣을 HTML (브라우저에서만) */
export function markdownToEditorHtml(md: string): string {
  const page = new DOMParser().parseFromString(`<body>${renderMarkdown(md)}</body>`, 'text/html');
  for (const box of [...page.querySelectorAll('div.md-center')]) {
    for (const child of [...box.children]) (child as HTMLElement).style.textAlign = 'center';
    box.replaceWith(...box.childNodes);
  }
  return page.body.innerHTML;
}

/** 편집기 문서 → md */
export function docToMarkdown(doc: DocNode): string {
  const blocks = [...(doc.content ?? [])];
  while (blocks.length > 0 && isEmptyParagraph(blocks[blocks.length - 1])) blocks.pop();
  const out: string[] = [];
  let centered: string[] = [];
  const flush = () => {
    if (centered.length > 0) out.push(`::: center\n${centered.join('\n\n')}\n:::`);
    centered = [];
  };
  for (const node of blocks) {
    if (isCentered(node)) centered.push(block(node));
    else {
      flush();
      out.push(block(node));
    }
  }
  flush();
  return out.length > 0 ? `${out.join('\n\n')}\n` : '';
}

function isEmptyParagraph(node: DocNode | undefined): boolean {
  return (
    node?.type === 'paragraph' &&
    (node.content ?? []).every((c) => c.type === 'text' && !c.text?.trim())
  );
}

function isCentered(node: DocNode | undefined): boolean {
  return (
    (node?.type === 'paragraph' || node?.type === 'heading') && node.attrs?.textAlign === 'center'
  );
}

function block(node: DocNode): string {
  const children = () => (node.content ?? []).map(block);
  switch (node.type) {
    case 'paragraph': {
      const text = inline(node.content);
      return text === '' ? NBSP : text;
    }
    case 'heading': {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
      return `${'#'.repeat(level)} ${inline(node.content).replace(/\n/g, ' ')}`;
    }
    case 'blockquote':
      return prefixLines(children().join('\n\n'), '> ');
    case 'bigQuote':
      return prefixLines(`[!quote]\n${children().join('\n\n')}`, '> ');
    case 'bulletList':
      return list(node, () => '- ');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return list(node, (i) => `${start + i}. `);
    }
    case 'codeBlock': {
      const code = (node.content ?? []).map((c) => c.text ?? '').join('');
      const fence = '`'.repeat(Math.max(3, longestRun(code, '`') + 1));
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return `${fence}${lang}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    default:
      return node.content ? children().join('\n\n') : inline([node]);
  }
}

function list(node: DocNode, marker: (index: number) => string): string {
  return (node.content ?? [])
    .map((item, i) => {
      const head = marker(i);
      const body = (item.content ?? []).map(block).join('\n');
      return body
        .split('\n')
        .map((line, n) => (n === 0 ? head : line ? ' '.repeat(head.length) : '') + line)
        .join('\n');
    })
    .join('\n');
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n');
}

function longestRun(text: string, char: string): number {
  let best = 0;
  let run = 0;
  for (const c of text) {
    run = c === char ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** 바깥에서 안쪽 순서. 같은 순서로 열고 닫아야 겹친 표시가 맞게 닫힌다 */
const MARK_ORDER = ['link', 'bold', 'italic', 'strike'];
/** 기울임은 *로 (한글 사이의 _는 기울임이 되지 않는다) */
const DELIMITER: Record<string, string> = { bold: '**', italic: '*', strike: '~~' };

function sameMark(a: DocMark | undefined, b: DocMark | undefined): boolean {
  if (!a || !b) return false;
  return a.type === b.type && (a.type !== 'link' || a.attrs?.href === b.attrs?.href);
}

function open(mark: DocMark): string {
  return mark.type === 'link' ? '[' : (DELIMITER[mark.type] ?? '');
}

function close(mark: DocMark): string {
  if (mark.type !== 'link') return DELIMITER[mark.type] ?? '';
  const href = String(mark.attrs?.href ?? '');
  return /[\s()<>]/.test(href) ? `](<${href.replace(/[<>]/g, encodeURIComponent)}>)` : `](${href})`;
}

/** 글자 마디들 → md. 표시(굵게 등)가 바뀌는 곳에서만 열고 닫고, 빈칸은 표시 바깥으로 뺀다 */
function inline(nodes: DocNode[] = []): string {
  let out = '';
  let active: DocMark[] = [];
  const closeFrom = (keep: number) => {
    const closers = active.slice(keep).reverse().map(close).join('');
    const space = /[ \t ]+$/.exec(out)?.[0] ?? '';
    out = `${out.slice(0, out.length - space.length)}${closers}${space}`;
    active = active.slice(0, keep);
  };
  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      out += '\n';
      continue;
    }
    const text = node.text ?? '';
    const marks = (node.marks ?? []).filter(
      (m) => m.type === 'code' || MARK_ORDER.includes(m.type),
    );
    if (marks.some((m) => m.type === 'code')) {
      closeFrom(0);
      const fence = '`'.repeat(longestRun(text, '`') + 1);
      const pad = /^`|`$/.test(text) ? ' ' : '';
      out += `${fence}${pad}${text}${pad}${fence}`;
      continue;
    }
    if (!text.trim()) {
      out += text;
      continue;
    }
    const wanted = marks.sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
    let keep = 0;
    while (keep < active.length && keep < wanted.length && sameMark(active[keep], wanted[keep]))
      keep++;
    closeFrom(keep);
    const lead = /^[ \t ]+/.exec(text)?.[0] ?? '';
    const openers = wanted.slice(keep).map(open).join('');
    const lineStart = (out === '' || out.endsWith('\n')) && openers === '';
    out += `${lead}${openers}${escapeMd(text.slice(lead.length), lineStart && lead === '')}`;
    active = wanted;
  }
  closeFrom(0);
  return out;
}

/** md 기호로 읽히지 않게. 줄 맨 앞에서는 제목·인용·목록·구분선·블록 표시도 */
function escapeMd(text: string, lineStart: boolean): string {
  let t = text.replace(/[\\`*_~[\]<&]/g, '\\$&');
  if (lineStart)
    t = t
      .replace(/^(#{1,6}(?=\s|$)|>|[-+=](?=\s|[-=\s]*$)|:{2,})/, '\\$1')
      .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2');
  return t;
}
