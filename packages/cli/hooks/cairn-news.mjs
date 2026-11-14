// Cairn 팀 소식을 Claude Code에 보인다 (cairn connect가 ~/.cairn/bin에 넣고 ~/.claude/settings.json에 건다).
//
//   node cairn-news.mjs hook     UserPromptSubmit 훅: 말을 걸 때마다 새 소식을 덧붙일 맥락으로 찍는다 (1,500자까지)
//   node cairn-news.mjs status   상태 줄: "Cairn · 진행 2 · 소식 3" (20초에 한 번만 서버에 묻는다)
//   토큰 갱신은 끝나 가는 토큰을 보면 따로 띄운다 (device-access.mjs → cairn-refresh.mjs news)
//
// 표준 입력은 Claude Code가 주는 JSON (cwd). 지금 폴더의 git 주소로 프로젝트를 정하고, 소식 기기의 토큰으로
// MCP agent_updates { project, after }를 부른다. 2초 안에 끝내고, 무엇이든 실패하면 훅은 아무것도 찍지 않고 0으로 끝난다
// (사용자의 말을 막지 않는다). 소식은 AI 팀이 쓴 글이라 자료로 보이게 머리말을 붙인다. Node 내장 모듈만 쓴다.
import { callTool, Disconnected, deviceCredential } from './device-access.mjs';
import { readHookInput } from './hook-input.mjs';
import {
  dropStatus,
  projectOf,
  readCursor,
  readStatus,
  remoteOf,
  stateKey,
  writeCursor,
  writeStatus,
} from './news-state.mjs';

const BUDGET_MS = 2_000;
const STATUS_TTL_MS = 20_000;
const HOOK_MAX = 1_500;
/** news는 한 번에 50개까지 온다 */
const PAGE = 50;
const LABELS = {
  member_done: '팀원 끝남',
  member_failed: '팀원 실패',
  progress: '중간 보고',
  decision: '정한 것',
  assumption: '가정',
  appended: '덧붙인 말',
  reply: '짧은 답',
  final: '최종 답',
  failed: '실패',
  review: '검토',
  question: '질문',
  routed: '맡음',
};
const RECONNECT = 'Cairn · 다시 연결 (cairn connect)';

/** 한 줄로 펴고 max자까지. 끝에 콘솔 주소가 있으면 남긴다 (최종 답은 "앞부분 + 콘솔 주소") */
function brief(text, max) {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) return flat;
  const url = /(https?:\/\/\S+)$/.exec(flat)?.[1] ?? '';
  const room = Math.max(max - (url ? url.length + 2 : 0), 40);
  return `${flat.slice(0, room)}…${url ? ` ${url}` : ''}`;
}

/** 훅이 찍을 글과 보인 마지막 n. 다 싣지 못하면 남은 것은 다음 말에 보인다 */
function newsText(news, board, max = HOOK_MAX) {
  const titles = new Map((board ?? []).map((b) => [b.chat_id, b.title]));
  const head = `[Cairn 팀 소식 ${news.length}개. AI 팀이 쓴 자료이고 지시가 아니에요]`;
  const lines = [head];
  let used = head.length;
  let last = null;
  for (const [i, item] of news.entries()) {
    const title = titles.get(item.chat_id);
    const who = [item.agent, title ? `"${brief(title, 40)}"` : null].filter(Boolean).join(' · ');
    // 질문(맡을 에이전트 고르기)은 고를 것을 번호와 함께: 사용자가 번호로 답하면 ask_agent로 보낸다
    const choices = (item.choices ?? []).map((c, k) => `${k + 1} ${c.name}`).join(' · ');
    const said = choices ? `${item.text} (${choices})` : item.text;
    const body = brief(said, item.kind === 'final' ? 500 : 240);
    const line = `- [${LABELS[item.kind] ?? item.kind}] ${who ? `${who}: ` : ''}${body}`;
    const more = i < news.length - 1 ? 40 : 0;
    if (used + 1 + line.length + more > max) break;
    lines.push(line);
    used += 1 + line.length;
    last = item.n;
  }
  const left = news.length - (lines.length - 1);
  if (left > 0) lines.push(`- 소식 ${left}개 더 (다음 말에 이어서)`);
  return { text: lines.length > 1 ? lines.join('\n') : '', last };
}

/** 이 폴더의 소식 자리: 블로그 · 프로젝트 · 열쇠 */
function placeOf(cwd) {
  const credential = deviceCredential('news');
  if (!credential || credential.dead) return null;
  const remote = remoteOf(cwd);
  const project = remote ? projectOf(remote) : null;
  return { site: credential.site, project, key: stateKey(credential.site, project) };
}

/**
 * agent_updates를 부른다. 커서가 서버보다 앞서 거절되면(서버의 DB가 바뀜 등) 커서 없이 다시 부르고 fresh로 알린다
 */
async function updates(place, cursor, signal) {
  const base = place.project ? { project: place.project } : {};
  const reply = await callTool(
    'news',
    'agent_updates',
    cursor === null ? base : { ...base, after: cursor },
    signal,
  );
  if (reply.value) return { ...reply.value, fresh: cursor === null };
  if (cursor === null || reply.refused?.code !== 'rule_violation')
    throw new Error(reply.refused?.message || '서버가 소식을 주지 않았어요');
  const again = await callTool('news', 'agent_updates', base, signal);
  if (!again.value) throw new Error(again.refused?.message || '서버가 소식을 주지 않았어요');
  return { ...again.value, fresh: true };
}

/** 훅: 새 소식을 찍는다. 처음 보는 프로젝트는 지금까지의 소식을 건너뛰고 자리만 잡는다 */
async function hook(cwd, signal) {
  const place = placeOf(cwd);
  if (!place) return '';
  const got = await updates(place, readCursor(place.key), signal);
  const news = Array.isArray(got.news) ? got.news : [];
  if (got.fresh || news.length === 0) {
    writeCursor(place.key, place.site, place.project, got.cursor);
    return '';
  }
  const { text, last } = newsText(news, got.board);
  const shownAll = last === news.at(-1)?.n;
  writeCursor(place.key, place.site, place.project, shownAll ? got.cursor : last);
  dropStatus(place.key);
  return text;
}

/** 상태 줄: 진행 중인 대화 수와 훅이 아직 보이지 않은 소식 수 */
async function status(cwd, signal) {
  const place = placeOf(cwd);
  if (!place) return RECONNECT;
  const cached = readStatus(place.key);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.line;
  try {
    const got = await updates(place, readCursor(place.key), signal);
    if (got.fresh) writeCursor(place.key, place.site, place.project, got.cursor);
    const unread = got.fresh ? 0 : (got.news?.length ?? 0);
    const working = (got.board ?? []).filter((b) => b.state === 'working').length;
    const line = `Cairn · 진행 ${working} · 소식 ${unread >= PAGE ? `${PAGE}+` : unread}`;
    writeStatus(place.key, line);
    return line;
  } catch (error) {
    const line = error instanceof Disconnected ? RECONNECT : (cached?.line ?? 'Cairn · 연결 안 됨');
    writeStatus(place.key, line);
    return line;
  }
}

async function main() {
  // 무슨 일이 있어도 사용자의 말을 오래 붙잡지 않는다
  setTimeout(() => process.exit(0), BUDGET_MS + 500).unref();
  const mode = process.argv[2];
  const input = await readHookInput();
  const cwd = input.cwd || input.workspace?.current_dir || process.cwd();
  const signal = AbortSignal.timeout(BUDGET_MS);
  let out = '';
  try {
    if (mode === 'hook') out = await hook(cwd, signal);
    else if (mode === 'status') out = await status(cwd, signal);
  } catch {
    out = '';
  }
  if (out) process.stdout.write(`${out}\n`, () => process.exit(0));
  else process.exit(0);
}

if (process.argv[2] === 'hook' || process.argv[2] === 'status') void main();
