// 웹 AI 대화 → save_transcript의 본문. 화면에서 읽은 메시지(사람 · AI)를 순서대로 마크다운으로 적는다.
//   ## 사람
//
//   (메시지)
//
//   ## AI
//
//   (답)
// 서버가 받는 길이(1,000,000자)를 넘으면 앞의 메시지부터 빼고 맨 위에 뺀 개수를 적는다 (새로 쌓인 쪽을 남긴다).
import { clip } from './clip.js';

const TEXT_MAX = 1_000_000;
const TITLE_MAX = 200;
/** 한 번에 받는 메시지 수 (그보다 많으면 뒤의 것만) */
const MESSAGES_MAX = 5_000;
const ROLES = { person: '사람', ai: 'AI' };

/** 콘텐츠 스크립트가 보낸 메시지들 중 모양이 맞는 것만. 페이지에서 온 값이라 그대로 믿지 않는다 */
export function messagesOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-MESSAGES_MAX).flatMap((m) => {
    if (!m || typeof m.text !== 'string' || !Object.hasOwn(ROLES, m.role)) return [];
    const text = m.text.trim();
    return text ? [{ role: m.role, text }] : [];
  });
}

/** 메시지들 → 마크다운. 메시지가 없으면 빈 글자 */
export function transcriptText(messages, max = TEXT_MAX) {
  const blocks = messages.map((m) => `## ${ROLES[m.role]}\n\n${m.text}`);
  const whole = blocks.join('\n\n');
  if (whole.length <= max) return whole;
  // 앞에서부터 하나씩 뺀다. rest는 남은 메시지들을 이은 길이
  let rest = whole.length;
  let dropped = 0;
  do {
    rest -= blocks[dropped].length + 2;
    dropped += 1;
  } while (dropped < blocks.length - 1 && rest + 2 + droppedNote(dropped).length > max);
  return clip(`${droppedNote(dropped)}\n\n${blocks.slice(dropped).join('\n\n')}`, max);
}

function droppedNote(count) {
  return `_(앞의 메시지 ${count}개는 길어서 뺐어요)_`;
}

/** 대화 제목: 한 줄로, 200자까지. 없으면 빈 글자 */
export function titleOf(raw) {
  return clip(
    String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    TITLE_MAX,
  );
}

/** 대화 하나의 내용 해시 (SHA-256, 16진수). 같으면 다시 올리지 않는다 */
export async function transcriptHash(tool, id, title, text) {
  const data = new TextEncoder().encode(JSON.stringify([tool, id, title, text]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 해시 → request_id (UUID 모양, 버전 8: 직접 만든 값). 같은 내용을 다시 보내도(응답을 못 받아 다시 보낼 때)
 * 서버가 한 번만 처리한다
 */
export function requestIdOf(hash) {
  const h = hash.slice(0, 32);
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20)}`;
}
