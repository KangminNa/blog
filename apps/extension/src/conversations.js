// 콘텐츠 스크립트가 보낸 웹 AI 대화를 save_transcript로 올린다.
// 같은 내용은 다시 올리지 않는다: 대화마다(도구 + 대화 id) 마지막으로 올린 내용의 해시를 저장소의 seen에 둔다.
// 사이트별로 끌 수 있다 (저장소의 sites, 없으면 켜짐).
import { Problem } from './problem.js';
import { messagesOf, requestIdOf, titleOf, transcriptHash, transcriptText } from './transcript.js';

/** 도구 이름 → 그 대화를 보낼 수 있는 페이지의 origin (다른 사이트의 페이지가 다른 도구 이름으로 올리지 못하게) */
const SITES = {
  'chatgpt-web': 'https://chatgpt.com',
  'claude-web': 'https://claude.ai',
  'gemini-web': 'https://gemini.google.com',
};
/** 해시를 기억하는 대화 수. 넘으면 오래전에 올린 것부터 잊는다 (잊은 대화가 다시 와도 서버가 unchanged로 답한다) */
const SEEN_MAX = 500;
/** 대화 id 모양 (주소의 /c/<id> · /chat/<id> · /app/<id>) */
const CONVERSATION_ID = /^[\w-]{1,200}$/;

export class Conversations {
  /**
   * @param {object} deps
   * @param {{ get(key: string): Promise<object>, set(items: object): Promise<void> }} deps.store
   * @param {import('./mcp.js').Mcp} deps.mcp
   * @param {import('./connection.js').Connection} deps.connection
   * @param {() => number} [deps.now]
   */
  constructor({ store, mcp, connection, now = () => Date.now() }) {
    this.store = store;
    this.mcp = mcp;
    this.connection = connection;
    this.now = now;
    /** 받은 대화를 하나씩 (seen을 읽고 고치는 사이에 다른 대화가 끼지 않게) */
    this.queue = Promise.resolve();
  }

  /** 사이트별 켜기 · 끄기 { 'chatgpt-web': true, … } */
  async sites() {
    const { sites } = await this.store.get('sites');
    return Object.fromEntries(Object.keys(SITES).map((tool) => [tool, sites?.[tool] !== false]));
  }

  async setSites(changes) {
    const next = await this.sites();
    for (const tool of Object.keys(SITES))
      if (typeof changes?.[tool] === 'boolean') next[tool] = changes[tool];
    await this.store.set({ sites: next });
    return next;
  }

  /**
   * 대화 하나를 받는다.
   * @param {{ tool: string, conversationId: string, title?: string, messages: { role: string, text: string }[] }} capture
   * @param {string} from 보낸 페이지의 주소
   * @returns {Promise<{ status: string }>} 서버의 saved · unchanged · skipped, 또는 same(이미 올림) · off(꺼짐 · 연결 없음) · empty · ignored(대화 id 없음)
   */
  receive(capture, from) {
    const run = this.queue.then(() => this.save(capture, from));
    this.queue = run.catch(() => {});
    return run;
  }

  async save(capture, from) {
    const tool = capture?.tool;
    if (!Object.hasOwn(SITES, tool) || originOf(from) !== SITES[tool])
      throw new Problem('이 사이트의 대화가 아니에요');
    const id = String(capture.conversationId ?? '');
    if (!CONVERSATION_ID.test(id)) return { status: 'ignored' };
    if (!(await this.connection.connected()) || !(await this.sites())[tool])
      return { status: 'off' };
    const text = transcriptText(messagesOf(capture.messages));
    if (!text) return { status: 'empty' };
    const title = titleOf(capture.title);
    const hash = await transcriptHash(tool, id, title, text);
    const key = `${tool}:${id}`;
    const { seen } = await this.store.get('seen');
    if (seen?.[key]?.hash === hash) return { status: 'same' };
    const reply = await this.mcp.call('save_transcript', {
      request_id: requestIdOf(hash),
      tool,
      source_session_id: id,
      ...(title ? { title } : {}),
      text,
    });
    await this.store.set({ seen: newest({ ...seen, [key]: { hash, at: this.now() } }) });
    return { status: String(reply.status ?? 'saved') };
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** 최근에 올린 SEEN_MAX개만 */
function newest(seen) {
  const entries = Object.entries(seen);
  if (entries.length <= SEEN_MAX) return seen;
  return Object.fromEntries(entries.sort(([, a], [, b]) => b.at - a.at).slice(0, SEEN_MAX));
}
