// 서비스 워커: 팝업과 콘텐츠 스크립트의 요청을 받아 블로그(MCP)를 부른다. 토큰은 여기서만 쓴다.
//   팝업(확장의 페이지)     status · inbox · connect · disconnect · sites · keep · ask
//   콘텐츠 스크립트(웹 AI)  watch(기다릴 시간) · transcript(대화 하나)
// 알람으로 1분마다 기다리는 결재 · 질문 수를 읽어 배지에 적는다.
import { Connection } from './connection.js';
import { Conversations } from './conversations.js';
import { Inbox } from './inbox.js';
import { Mcp } from './mcp.js';
import { siteOrigin } from './oauth.js';
import { askMessage, keepArgs } from './page.js';
import { describe, Problem } from './problem.js';

const INBOX_ALARM = 'inbox';
/** 답이 끝났다고 보는 조용한 시간. 저장소의 quietMs로 바꿀 수 있다 (시험에서 줄인다) */
const QUIET_MS = 20_000;

const store = chrome.storage.local;
// 콘텐츠 스크립트(남의 페이지 안에서 도는 코드)는 저장소를 읽지 못하게 한다. 토큰이 있다
store.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

const send = (url, init) => fetch(url, init);
const connection = new Connection({
  store,
  fetch: send,
  launch: (url) => chrome.identity.launchWebAuthFlow({ url, interactive: true }),
  redirectUri: chrome.identity.getRedirectURL(),
});
const mcp = new Mcp({ connection, fetch: send });
const conversations = new Conversations({ store, mcp, connection });
const inbox = new Inbox({
  mcp,
  connection,
  badge: (text) => chrome.action.setBadgeText({ text }),
});

function start() {
  chrome.alarms.create(INBOX_ALARM, { periodInMinutes: 1 });
  chrome.action.setBadgeBackgroundColor({ color: '#000000' });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
  refreshInbox();
}

function refreshInbox() {
  inbox.refresh().catch((error) => console.warn('결재 수를 읽지 못했어요:', error.message));
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === INBOX_ALARM) refreshInbox();
});

/** 팝업만 부를 수 있는 일 */
const fromPopup = {
  status: async () => {
    // 연결하다 실패한 까닭은 한 번만 보인다
    const { connectProblem } = await store.get('connectProblem');
    if (connectProblem) await store.remove('connectProblem');
    return {
      ...(await connection.status()),
      sites: await conversations.sites(),
      problem: connectProblem ?? null,
    };
  },
  inbox: async () => ({ counts: await inbox.refresh() }),
  connect: async ({ site }) => {
    let connected;
    try {
      connected = await connection.connect(siteOrigin(site));
    } catch (error) {
      // 승인 창이 열리면 팝업이 닫힌다. 실패한 까닭을 남겨 두었다가 다음에 팝업을 열 때 보인다
      await store.set({ connectProblem: describe(error) });
      throw error;
    }
    // 연결하면 모든 사이트의 대화 모으기가 켜진다
    await store.remove('sites');
    refreshInbox();
    return { site: connected };
  },
  disconnect: async () => {
    const site = await connection.disconnect();
    await chrome.action.setBadgeText({ text: '' });
    if (site)
      await chrome.permissions.remove({ origins: [`${new URL(site).origin}/*`] }).catch(() => {});
    return {};
  },
  sites: async ({ sites }) => ({ sites: await conversations.setSites(sites) }),
  keep: async ({ page }) => {
    const reply = await mcp.call('keep_page', keepArgs(page, crypto.randomUUID()));
    return { status: reply.status === 'duplicate' ? 'duplicate' : 'saved' };
  },
  ask: async ({ words, page }) => {
    const reply = await mcp.call('ask_agent', {
      request_id: crypto.randomUUID(),
      message: askMessage(words, page ?? null),
    });
    const { site } = await connection.status();
    if (typeof reply.id === 'string' && site)
      await chrome.tabs.create({ url: `${site}/admin/chats/${encodeURIComponent(reply.id)}` });
    return { chatId: reply.id ?? null };
  },
};

/** 콘텐츠 스크립트(웹 AI 사이트의 페이지)가 부르는 일 */
const fromPage = {
  watch: async () => {
    const { quietMs } = await store.get('quietMs');
    return { quietMs: Number(quietMs) > 0 ? Number(quietMs) : QUIET_MS };
  },
  transcript: (message, sender) => conversations.receive(message, sender.url),
};

/** 보낸 곳에 맞는 일. 확장의 페이지면 팝업의 일, 아니면 콘텐츠 스크립트의 일만 */
function handlerFor(message, sender) {
  if (sender.id !== chrome.runtime.id || typeof message?.type !== 'string') return null;
  const ownPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  const table = ownPage ? fromPopup : fromPage;
  return Object.hasOwn(table, message.type) ? table[message.type] : null;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = handlerFor(message, sender);
  if (!handler) return false;
  handler(message, sender).then(
    (value) => reply({ ok: true, ...value }),
    (error) => {
      if (!(error instanceof Problem)) console.error('처리하지 못했어요:', error.message);
      reply({ ok: false, message: describe(error) });
    },
  );
  return true;
});
