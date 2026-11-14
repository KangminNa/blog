// 확장을 실제 Chromium(창 없이)에 올려 처음부터 끝까지 본다.
//   - 가짜 Cairn(127.0.0.1)과 가짜 chatgpt.com · claude.ai · 글 페이지(context.route)
//   - 연결은 승인 창을 띄울 수 없어 서비스 워커로 저장소에 열쇠를 넣는다 (연결 흐름은 단위 테스트가 본다)
//   - 연결할 때 받는 사이트 권한과, 팝업을 누를 때 받는 activeTab 대신 시험용 manifest에 host_permissions를 더한다
// Playwright(require('playwright'))와 그 Chromium이 없으면 건너뛴다.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACCESS_TOKEN, FakeCairn } from './fake-cairn.js';
import { ARTICLE, CHATGPT, CLAUDE, GEMINI } from './fake-pages.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLE_URL = 'https://news.example/articles/1';

function loadPlaywright() {
  try {
    const playwright = createRequire(import.meta.url)('playwright');
    return existsSync(playwright.chromium.executablePath()) ? playwright : null;
  } catch {
    return null;
  }
}
const playwright = loadPlaywright();

/** check가 참이 될 때까지 (기본 15초) */
async function until(check, what, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`기다렸지만 오지 않았어요: ${what}`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

/** 시험용 확장 폴더: 저장소의 확장 + host_permissions */
function extensionCopy(dir) {
  cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://news.example/*'];
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
}

describe('확장 (Chromium)', { skip: playwright ? false : 'Playwright · Chromium 없음' }, () => {
  const cairn = new FakeCairn();
  const temp = mkdtempSync(join(tmpdir(), 'cairn-extension-'));
  let context;
  let worker;

  before(async () => {
    await cairn.start();
    extensionCopy(join(temp, 'extension'));
    const extension = join(temp, 'extension');
    context = await playwright.chromium.launchPersistentContext(join(temp, 'profile'), {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    for (const [pattern, body] of [
      ['https://chatgpt.com/**', CHATGPT],
      ['https://claude.ai/**', CLAUDE],
      ['https://gemini.google.com/**', GEMINI],
      ['https://news.example/**', ARTICLE],
    ])
      await context.route(pattern, (route) =>
        route.fulfill({ contentType: 'text/html; charset=utf-8', body }),
      );
    // 연결한 것처럼: 열쇠를 넣고, 답이 끝났다고 보는 시간을 줄인다
    await worker.evaluate(
      ({ site, token }) =>
        chrome.storage.local.set({
          connection: {
            site,
            mcp: `${site}/mcp`,
            tokenEndpoint: `${site}/oauth/token`,
            revokeEndpoint: `${site}/oauth/revoke`,
            clientId: 'e2e-client',
            accessToken: token,
            refreshToken: 'e2e-refresh',
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            scope: 'upload delegate inbox',
          },
          quietMs: 800,
        }),
      { site: cairn.site, token: ACCESS_TOKEN },
    );
  });

  after(async () => {
    await context?.close();
    await cairn.stop();
    rmSync(temp, { recursive: true, force: true });
  });

  it('ChatGPT 대화: 답이 끝난 뒤 한 번 올린다', async () => {
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/c/e2e-chatgpt-1');
    const chatgpt = () =>
      cairn.argumentsOf('save_transcript').filter((a) => a.tool === 'chatgpt-web');
    const [args] = await until(() => chatgpt().length > 0 && chatgpt(), 'ChatGPT 대화');
    assert.equal(args.source_session_id, 'e2e-chatgpt-1');
    assert.equal(args.title, '피보나치 함수');
    assert.match(args.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
    assert.ok(args.text.startsWith('## 사람\n\n피보나치 함수를 짜 줘\n\n## AI\n\n여기 있어요.'));
    assert.ok(args.text.includes('const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2));'));
    assert.ok(args.text.endsWith('끝까지 썼어요.'), '답을 쓰는 중에는 올리지 않는다');
    // 화면이 다시 조용해져도 같은 내용은 다시 올리지 않는다
    await page.evaluate(() => document.body.append(document.createElement('span')));
    await new Promise((done) => setTimeout(done, 2000));
    assert.equal(chatgpt().length, 1);
    await page.close();
  });

  it('Claude 대화: 도구 이름과 대화 id, 제목', async () => {
    const page = await context.newPage();
    await page.goto('https://claude.ai/chat/e2e-claude-1');
    const args = await until(
      () => cairn.argumentsOf('save_transcript').find((a) => a.tool === 'claude-web'),
      'Claude 대화',
    );
    assert.equal(args.source_session_id, 'e2e-claude-1');
    assert.equal(args.title, '회의록 요약');
    assert.equal(
      args.text,
      '## 사람\n\n회의록을 세 줄로 요약해 줘\n\n## AI\n\n첫째, 일정을 미뤘어요.\n\n둘째, 예산을 늘렸어요.\n\n셋째, 담당을 정했어요.',
    );
    await page.close();
  });

  it('Gemini 대화: 옆 목록의 제목', async () => {
    const page = await context.newPage();
    await page.goto('https://gemini.google.com/app/e2e-gemini-1');
    const args = await until(
      () => cairn.argumentsOf('save_transcript').find((a) => a.tool === 'gemini-web'),
      'Gemini 대화',
    );
    assert.equal(args.source_session_id, 'e2e-gemini-1');
    assert.equal(args.title, '부산 여행');
    assert.equal(
      args.text,
      '## 사람\n\n부산 여행 일정을 짜 줘\n\n## AI\n\n첫째 날은 해운대예요.\n\n둘째 날은 감천마을이에요.',
    );
    await page.close();
  });

  it('대화 id가 없는 페이지는 올리지 않는다', async () => {
    const page = await context.newPage();
    await page.goto('https://chatgpt.com/');
    await new Promise((done) => setTimeout(done, 3000));
    assert.equal(cairn.argumentsOf('save_transcript').length, 3);
    await page.close();
  });

  it('팝업: 배지 · 이 페이지 보관 · 맡기기 · 사이트 끄기 · 콘솔 열기', async () => {
    const article = await context.newPage();
    await article.goto(ARTICLE_URL);
    await article.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('quote'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await article.bringToFront();
    // 지난번 연결이 실패한 까닭은 다음에 팝업을 열 때 한 번 보인다
    await worker.evaluate(() =>
      chrome.storage.local.set({ connectProblem: '연결하지 못했어요: 시험' }),
    );
    // 팝업은 보던 창에 붙어 열린다. 시험에서는 따로 작은 창으로 연다
    const opened = context.waitForEvent('page');
    await worker.evaluate(
      (url) => chrome.windows.create({ url, type: 'popup' }),
      worker.url().replace('src/background.js', 'src/popup/popup.html'),
    );
    const popup = await opened;
    await popup.waitForSelector('#connected:not([hidden])');
    assert.equal(await popup.textContent('#state'), `연결: ${new URL(cairn.site).host}`);
    assert.equal(await popup.textContent('#result.error'), '연결하지 못했어요: 시험');
    const { connectProblem } = await worker.evaluate(() =>
      chrome.storage.local.get('connectProblem'),
    );
    assert.equal(connectProblem, undefined);
    await until(async () => (await popup.textContent('#count')) === '결재 2 · 질문 1', '결재 수');
    assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), '3');
    const alarm = await worker.evaluate(() => chrome.alarms.get('inbox'));
    assert.equal(alarm?.periodInMinutes, 1);

    await popup.click('#keep');
    await until(async () => (await popup.textContent('#result')) === '보관했어요', '보관');
    const [kept] = cairn.argumentsOf('keep_page');
    assert.equal(kept.url, ARTICLE_URL);
    assert.equal(kept.title, '읽을 만한 글');
    assert.equal(kept.text, '이 문단을 골라 보관해요.');

    const chat = context.waitForEvent('page', (p) => p.url().includes('/admin/chats/'));
    await popup.fill('#words', '이 글을 세 줄로 요약해 줘');
    await popup.click('#ask button[type=submit]');
    assert.equal((await chat).url(), `${cairn.site}/admin/chats/chat-1`);
    const [asked] = cairn.argumentsOf('ask_agent');
    assert.equal(
      asked.message,
      `이 글을 세 줄로 요약해 줘\n\n페이지: ${ARTICLE_URL}\n제목: 읽을 만한 글\n\n고른 부분:\n이 문단을 골라 보관해요.`,
    );
    assert.match(asked.request_id, /^[0-9a-f-]{36}$/);

    await popup.uncheck('input[name="gemini-web"]');
    const sites = await until(async () => {
      const { sites } = await worker.evaluate(() => chrome.storage.local.get('sites'));
      return sites?.['gemini-web'] === false && sites;
    }, '사이트 끄기');
    assert.deepEqual(sites, { 'chatgpt-web': true, 'claude-web': true, 'gemini-web': false });
    const gemini = await context.newPage();
    await gemini.goto('https://gemini.google.com/app/e2e-gemini-2');
    await new Promise((done) => setTimeout(done, 3000));
    assert.equal(
      cairn.argumentsOf('save_transcript').some((a) => a.source_session_id === 'e2e-gemini-2'),
      false,
      '끈 사이트의 대화는 올리지 않는다',
    );
    await gemini.close();

    const admin = context.waitForEvent('page', (p) => p.url() === `${cairn.site}/admin`);
    await popup.click('#console');
    await admin;
  });
});
