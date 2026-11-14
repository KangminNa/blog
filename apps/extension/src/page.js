// "이 페이지 보관"(keep_page) · "이 페이지로 맡기기"(ask_agent)에 보낼 값.
// 페이지에서 읽은 값은 글로만 다룬다: 실행하거나 해석하지 않고, 길이에 맞춰 잘라 보낸다.
import { clip } from './clip.js';
import { Problem } from './problem.js';

const URL_MAX = 2000;
const TITLE_MAX = 200;
const KEEP_TEXT_MAX = 10_000;
const MESSAGE_MAX = 8000;

/**
 * 탭 안에서 돈다 (chrome.scripting.executeScript의 func로 넘긴다). 그래서 바깥 이름을 쓰지 않는다.
 * 읽기만 한다: 고른 부분, 본문(article · main · body 순)의 앞부분
 */
export function readPage() {
  const root = document.querySelector('article') ?? document.querySelector('main') ?? document.body;
  return {
    url: location.href,
    title: document.title,
    selection: String(getSelection() ?? ''),
    text: String(root?.innerText ?? '').slice(0, 20_000),
  };
}

/** 보관(keep_page)의 인자. 글은 고른 부분, 없으면 본문의 앞부분 */
export function keepArgs(page, requestId) {
  const url = webUrl(page?.url);
  const text = clip(tidy(page.selection) || tidy(page.text), KEEP_TEXT_MAX);
  return {
    request_id: requestId,
    url,
    title: clip(oneLine(page.title) || url, TITLE_MAX),
    ...(text ? { text } : {}),
  };
}

/**
 * 맡기기(ask_agent)의 메시지: 사용자의 말, 그 아래 페이지 주소 · 제목, 고른 부분.
 * 8000자를 넘으면 고른 부분을 줄인다
 * @param {string} words 사용자가 적은 말
 * @param {{ url: string, title?: string, selection?: string } | null} page 읽지 못했으면 null
 */
export function askMessage(words, page) {
  const said = tidy(words);
  if (!said) throw new Problem('맡길 일을 적어 주세요');
  const lines = [said];
  if (page) {
    lines.push('', `페이지: ${webUrl(page.url)}`);
    const title = oneLine(page.title);
    if (title) lines.push(`제목: ${clip(title, TITLE_MAX)}`);
  }
  const head = lines.join('\n');
  const selection = page ? tidy(page.selection) : '';
  const label = '\n\n고른 부분:\n';
  const room = MESSAGE_MAX - head.length - label.length;
  if (!selection || room <= 0) return clip(head, MESSAGE_MAX);
  return `${head}${label}${clip(selection, room)}`;
}

/** http(s) 주소만, 2000자까지 */
function webUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    throw new Problem('페이지 주소를 읽지 못했어요');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Problem('웹 페이지에서만 쓸 수 있어요');
  if (url.href.length > URL_MAX) throw new Problem('주소가 너무 길어요 (2000자까지)');
  return url.href;
}

function oneLine(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 줄 끝 빈칸과 세 줄 넘는 빈 줄을 줄인다 */
function tidy(text) {
  return String(text ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
