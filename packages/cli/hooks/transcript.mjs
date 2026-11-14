// Claude Code 대화 원문(JSONL) → 사람이 읽는 글 (세션 저장, cairn-collect.mjs가 쓴다). Node 내장 모듈만 쓴다.
//
// 한 줄에 JSON 하나: { type: 'user' | 'assistant' | …, message: { content: 글 | [블록…] }, timestamp, cwd, … }.
// 남기는 것: 사람이 쓴 글, AI가 쓴 글, AI가 쓴 도구의 이름. 버리는 것: 도구의 입력 · 결과, 생각(thinking),
// 곁가지(isSidechain) · 메타(isMeta) · 대화 줄임 요약(isCompactSummary), <system-reminder>, Claude Code가 넣은 태그 글.
// 원문 파일의 모양은 도구가 공개한 약속이 아니다. 읽지 못하는 줄은 건너뛴다.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
/** Claude Code가 사람 자리에 넣는 글 (<command-name> · <local-command-stdout> · <bash-input> …) */
const TOOL_TAG = /^<[a-z]+(?:-[a-z]+)+>/;
const INTERRUPTED = /^\[Request interrupted by user/;

/** 대화 한 차례: 사람이나 AI가 이어서 한 말들 */
class Turn {
  constructor(role) {
    this.role = role;
    /** 글 조각과 도구 이름 묶음([이름…])이 나온 순서대로 */
    this.parts = [];
  }

  addText(text) {
    this.parts.push(text);
  }

  addTool(name) {
    const last = this.parts.at(-1);
    if (Array.isArray(last)) last.push(name);
    else this.parts.push([name]);
  }

  /** "## 사람" / "## AI" 아래 글. 이어서 쓴 도구는 (도구: Bash ×2, Edit) 한 줄로 */
  toText() {
    const body = this.parts.map((part) => {
      if (!Array.isArray(part)) return part;
      const counts = new Map();
      for (const name of part) counts.set(name, (counts.get(name) ?? 0) + 1);
      const names = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name));
      return `(도구: ${names.join(', ')})`;
    });
    return [`## ${this.role === 'human' ? '사람' : 'AI'}`, ...body].join('\n\n');
  }
}

/** 사람 자리의 글 하나. 사람이 쓴 것이 아니면 '' */
function humanText(text) {
  const clean = String(text ?? '')
    .replace(REMINDER, '')
    .trim();
  return TOOL_TAG.test(clean) || INTERRUPTED.test(clean) ? '' : clean;
}

/**
 * 원문 파일을 읽어 차례들과 시작 시각 · 폴더를 돌려준다.
 * 줄 단위로 읽는다 (원문은 도구 결과 때문에 수십 MB가 되기도 한다)
 */
export async function readTranscript(file) {
  const turns = [];
  let startedAt = null;
  let cwd = null;
  const turn = (role) => {
    if (turns.at(-1)?.role !== role) turns.push(new Turn(role));
    return turns.at(-1);
  };
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    if (startedAt === null && !Number.isNaN(Date.parse(o.timestamp ?? '')))
      startedAt = new Date(o.timestamp).toISOString();
    if (cwd === null && typeof o.cwd === 'string') cwd = o.cwd;
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    const content = o.message?.content;
    if (o.type === 'user') {
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
      for (const block of Array.isArray(blocks) ? blocks : []) {
        const text = block?.type === 'text' ? humanText(block.text) : '';
        if (text) turn('human').addText(text);
      }
    }
    if (o.type === 'assistant' && Array.isArray(content))
      for (const block of content) {
        const text = block?.type === 'text' ? String(block.text ?? '').trim() : '';
        if (text) turn('ai').addText(text);
        if (block?.type === 'tool_use' && block.name) turn('ai').addTool(String(block.name));
      }
  }
  return { turns, startedAt, cwd };
}

/** 차례들을 글 하나로 */
export function transcriptText(turns) {
  return turns.map((t) => t.toText()).join('\n\n');
}

/** 제목: 사람의 첫 말의 첫 줄. 사람이 말하지 않았으면 null */
export function titleOf(turns) {
  const first = turns.find((t) => t.role === 'human')?.parts[0];
  return typeof first === 'string'
    ? (first
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) ?? null)
    : null;
}

/** 앞에서 max자까지 (UTF-16 길이 기준, 이모지 같은 두 칸 글자를 자르지 않는다) */
export function cut(text, max) {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? '') ? max - 1 : max;
  return text.slice(0, end);
}

/** max자를 넘으면 앞과 뒤를 남기고 가운데를 줄인다 */
export function trimMiddle(text, max) {
  if (text.length <= max) return text;
  const room = max - 64;
  let head = Math.ceil(room / 2);
  let tail = text.length - Math.floor(room / 2);
  if (/[\uD800-\uDBFF]/.test(text[head - 1] ?? '')) head -= 1;
  if (/[\uDC00-\uDFFF]/.test(text[tail] ?? '')) tail += 1;
  const marker = `\n\n… (가운데 ${(tail - head).toLocaleString('en-US')}자 줄임) …\n\n`;
  return `${text.slice(0, head)}${marker}${text.slice(tail)}`;
}
