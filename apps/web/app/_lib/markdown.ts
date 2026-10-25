import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

// 블로그 글 본문(md) → HTML. 방문자의 글 페이지(서버)와 편집기의 미리 보기(브라우저)가 같은 것을 쓴다.
// 글 문법 (기획서 2026-10-03, 네이버 블로그식 본문):
//   ::: center … :::   가운데 정렬 블록
//   > [!quote]         큰 인용 (옵시디언 callout과 같은 모양)
//   그 밖은 일반 md + GFM(표·취소선·체크 목록). 문단 안의 줄바꿈(엔터 한 번)도 줄을 바꾼다 (블로그 글쓰기 습관)
// 사진·갤러리(::: gallery)·영상(::youtube{…})·링크 카드(::link{…})는 사진 올리기 단계에서 더한다.
// 본문에 쓴 HTML은 그리지 않고(remark-rehype 기본), 결과도 한 번 더 거른다(rehype-sanitize).

/** md 문법 나무의 마디 (remark가 만드는 모양 중 여기서 보는 것만) */
type MdNode = {
  type: string;
  name?: string;
  value?: string;
  attributes?: Record<string, string | null | undefined> | null;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
};

const QUOTE = /^\[!quote\][ \t]*\n?/i;

/** 마디 안의 글자만 (지시문을 글자로 되돌릴 때) */
function textOf(node: MdNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join('');
}

/** 아직 그리지 않는 지시문은 쓴 글자 그대로 남긴다 (예: "Note:hello"의 ":hello"가 사라지지 않게) */
function asText(node: MdNode, colons: string): MdNode {
  const label = node.children?.length ? `[${textOf(node)}]` : '';
  const attrs = Object.entries(node.attributes ?? {})
    .map(([k, v]) => (v ? `${k}=${v}` : k))
    .join(' ');
  return { type: 'text', value: `${colons}${node.name ?? ''}${label}${attrs ? `{${attrs}}` : ''}` };
}

/** 글자 안의 줄바꿈을 줄바꿈 마디로 (코드는 글자 마디가 아니라 그대로) */
function breakLines(node: MdNode): MdNode[] {
  if (node.type !== 'text' || !node.value?.includes('\n')) return [node];
  const out: MdNode[] = [];
  node.value.split('\n').forEach((line, i) => {
    if (i > 0) out.push({ type: 'break' });
    if (line) out.push({ type: 'text', value: line });
  });
  return out;
}

/** Cairn 글 문법을 HTML 모양으로 */
function cairnBlocks() {
  const walk = (node: MdNode): MdNode => {
    if (node.type === 'textDirective') return asText(node, ':');
    if (node.type === 'leafDirective') return { type: 'paragraph', children: [asText(node, '::')] };
    if (node.type === 'containerDirective') {
      node.data = {
        hName: 'div',
        hProperties: node.name === 'center' ? { className: ['md-center'] } : {},
      };
    }
    if (node.type === 'blockquote') {
      const first = node.children?.[0]?.children?.[0];
      if (first?.type === 'text' && first.value && QUOTE.test(first.value)) {
        first.value = first.value.replace(QUOTE, '');
        node.data = { hProperties: { className: ['md-quote'] } };
      }
    }
    if (node.children) node.children = node.children.flatMap(breakLines).map(walk);
    return node;
  };
  return (tree: MdNode) => {
    walk(tree);
  };
}

/** 기본 거르기 + Cairn 블록의 class 두 개만 더 허락 */
const schema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'md-center']],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), ['className', 'md-quote']],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(cairnBlocks)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

/** "::: center"처럼 콜론 뒤에 빈칸을 둔 블록도 받는다 (remark-directive는 ":::center"만 읽는다) */
const SPACED_FENCE = /^([ \t]{0,3}:{3,})[ \t]+(?=[a-z])/gim;

export function renderMarkdown(md: string): string {
  return String(processor.processSync(md.replace(SPACED_FENCE, '$1')));
}
