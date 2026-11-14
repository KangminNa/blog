// 팝업: 연결 상태 · 연결/연결 해제, 사이트별 대화 모으기, 이 페이지 보관 · 맡기기, 기다리는 결재 수와 콘솔 열기.
// 블로그는 서비스 워커(background.js)가 부른다. 팝업은 보낼 값을 모으고 답을 보여 주기만 한다.
import { siteOrigin } from '../oauth.js';
import { readPage } from '../page.js';

const $ = (id) => document.getElementById(id);
/** 연결한 블로그의 사이트 주소 */
let site = null;

/** 서비스 워커에 일 하나. 실패면 서버 · 확장이 준 문구로 Error */
async function call(type, values = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...values });
  if (!reply?.ok) throw new Error(reply?.message ?? '처리하지 못했어요');
  return reply;
}

function say(text, failed = false) {
  const result = $('result');
  result.textContent = text;
  result.classList.toggle('error', failed);
}

/** 단추를 누른 동안 막고, 끝나면 결과 문구를, 실패하면 오류 문구를 보인다 */
async function run(button, work) {
  button.disabled = true;
  say('');
  try {
    say(await work());
  } catch (error) {
    say(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function render() {
  const status = await call('status');
  site = status.site;
  const on = status.state === 'connected';
  $('connect').hidden = on;
  $('connected').hidden = !on;
  $('state').textContent = on
    ? `연결: ${new URL(site).host}`
    : status.state === 'lost'
      ? '연결이 끊겼어요. 다시 연결해 주세요'
      : '연결 안 됨';
  if (!on && site) $('site').value = site;
  for (const box of $('sites').querySelectorAll('input'))
    box.checked = status.sites[box.name] !== false;
  // 지난번 연결이 실패한 까닭 (승인 창이 열리며 팝업이 닫혀 그때 보이지 못한 것)
  if (status.problem) say(status.problem, true);
  if (on) await showInbox();
}

async function showInbox() {
  try {
    const { counts } = await call('inbox');
    const approvals = counts?.approvals ?? 0;
    const questions = counts?.questions ?? 0;
    $('count').textContent =
      approvals + questions === 0
        ? '기다리는 결재 · 질문 없음'
        : `결재 ${approvals} · 질문 ${questions}`;
  } catch (error) {
    $('count').textContent = error.message;
  }
}

/** 보고 있던 탭: 마지막으로 쓴 브라우저 창의 활성 탭 (팝업은 그 창에 붙어 열린다) */
async function currentTab() {
  const focused = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: focused.id });
  if (!tab?.id) throw new Error('보고 있는 페이지가 없어요');
  return tab;
}

/** 그 탭의 주소 · 제목 · 고른 부분 · 본문 앞부분. 페이지 안을 읽을 수 없으면 주소와 제목만 */
async function currentPage() {
  const tab = await currentTab();
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPage,
    });
    if (frame?.result) return frame.result;
  } catch {
    // 브라우저의 페이지 · 스토어처럼 확장이 읽을 수 없는 페이지
  }
  if (/^https?:/.test(tab.url ?? ''))
    return { url: tab.url, title: tab.title ?? '', selection: '', text: '' };
  throw new Error('웹 페이지에서만 쓸 수 있어요');
}

$('connect').addEventListener('submit', (event) => {
  event.preventDefault();
  let origin;
  try {
    origin = siteOrigin($('site').value);
  } catch (error) {
    say(error.message, true);
    return;
  }
  // 권한 창은 누른 그 순간에만 열 수 있어서, 다른 일을 기다리기 전에 묻는다
  const granted = chrome.permissions.request({ origins: [`${origin}/*`] });
  run(event.submitter, async () => {
    if (!(await granted)) throw new Error('사이트 권한이 있어야 연결할 수 있어요');
    say('열린 창에서 승인해 주세요');
    try {
      await call('connect', { site: origin });
    } finally {
      // 실패했으면 남겨 둔 까닭을 여기서 읽어 지운다 (같은 문구를 다음에 또 보이지 않게)
      await render();
    }
    return '연결했어요';
  });
});

$('sites').addEventListener('change', (event) => {
  const box = event.target;
  call('sites', { sites: { [box.name]: box.checked } }).catch((error) => {
    box.checked = !box.checked;
    say(error.message, true);
  });
});

$('keep').addEventListener('click', (event) =>
  run(event.currentTarget, async () => {
    const { status } = await call('keep', { page: await currentPage() });
    return status === 'duplicate' ? '이미 보관한 페이지예요' : '보관했어요';
  }),
);

$('ask').addEventListener('submit', (event) => {
  event.preventDefault();
  run(event.submitter, async () => {
    const page = await currentPage().catch(() => null);
    await call('ask', { words: $('words').value, page });
    $('words').value = '';
    return '맡겼어요';
  });
});

$('console').addEventListener('click', () => {
  if (site) chrome.tabs.create({ url: `${site}/admin` });
});

$('disconnect').addEventListener('click', (event) =>
  run(event.currentTarget, async () => {
    await call('disconnect');
    await render();
    return '연결 해제했어요';
  }),
);

render().catch((error) => say(error.message, true));
