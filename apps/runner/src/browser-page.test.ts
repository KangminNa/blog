import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { pause } from './backoff';
import { BrowserPages, type BrowserTab, ButtonProblem, ButtonRef } from './browser-page';
import { DevToolsSession } from './browser-tabs';
import { TestChromium } from './testing/test-chromium';

// 결재된 클릭의 브라우저 쪽 (진짜 Chromium): 붙잡기(역할 + 이름으로 다시 찾기 · 지문 · 화면) → 같으면 실제 마우스로 누르기,
// 페이지 · 버튼이 바뀌었거나 탭이 닫혔으면 누르지 않기. 사이트에 요청이 갔는지로 눌렀는지를 본다.

const FORM = `<!doctype html><html><head><meta charset="utf-8"><title>글쓰기</title></head><body>
<form action="/done" method="post"><input id="title" name="title"><button type="submit">게시</button></form>
<button disabled>보관</button>
<div style="position:relative"><button>덮인 버튼</button><div style="position:absolute;inset:0;background:#fff"></div></div>
</body></html>`;

describe('결재된 클릭 (실제 Chromium)', { skip: TestChromium.skip }, () => {
  let chromium: TestChromium;
  let site: Server;
  let url: string;
  let pages: BrowserPages;
  const posts: string[] = [];
  const signal = () => AbortSignal.timeout(20_000);
  const publish = new ButtonRef('button', '게시', 0);

  before(async () => {
    site = createServer((req, res) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => {
          body += c;
        });
        req.on('end', () => {
          posts.push(body);
          res
            .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            .end('<title>완료</title><p>게시했어요</p>');
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(FORM);
    });
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    chromium = await TestChromium.start();
    pages = new BrowserPages(chromium.endpoint);
  });

  after(async () => {
    await chromium.stop();
    site.closeAllConnections();
    site.close();
  });

  /** 새 탭으로 열어 제목 칸을 채운다 (AI가 Playwright MCP로 하는 일) */
  async function filled(path: string): Promise<BrowserTab> {
    const opened = await pages.open(`${url}${path}`, signal());
    await pause(800);
    await run(opened, "document.querySelector('#title').value = '시험 글'");
    return (await pages.tabs(signal())).find((t) => t.id === opened.id) as BrowserTab;
  }

  async function run(tab: BrowserTab, expression: string): Promise<unknown> {
    const s = await DevToolsSession.open(tab.socket, signal());
    const read = await s.send('Runtime.evaluate', { expression, returnByValue: true });
    s.close();
    return (read.result as { value?: unknown } | undefined)?.value;
  }

  test('붙잡기: 역할 + 이름으로 버튼을 다시 찾아 자리 · 지문 · 멈춘 화면(JPEG)을 만든다', async () => {
    const tab = await filled('/form?a');
    const held = await pages.hold(tab, publish, signal());
    assert.equal(held.pageUrl, `${url}/form?a`);
    assert.match(held.fingerprint, /^[0-9a-f]{64}$/);
    assert.ok(held.box.width > 0 && held.box.height > 0);
    const jpeg = Buffer.from(held.image, 'base64');
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(jpeg.length <= BrowserPages.SHOT_MAX);
    const again = await pages.hold(tab, publish, signal());
    assert.equal(again.fingerprint, held.fingerprint, '같은 페이지 · 같은 버튼이면 같은 지문');
    assert.equal(posts.length, 0, '붙잡기는 누르지 않는다');
  });

  test('없거나 · 꺼져 있거나 · 가려진 버튼은 붙잡지 않는다', async () => {
    const tab = await filled('/form?b');
    const problems = [
      [new ButtonRef('button', '없는 버튼', 0), /버튼이 없어요/],
      [new ButtonRef('button', '게시', 1), /버튼이 없어요/],
      [new ButtonRef('button', '보관', 0), /꺼져 있어요/],
      [new ButtonRef('button', '덮인 버튼', 0), /가려져 있어요/],
    ] as const;
    for (const [button, problem] of problems)
      await assert.rejects(pages.hold(tab, button, signal()), (e: unknown) => {
        assert.ok(e instanceof ButtonProblem);
        assert.match(e.message, problem);
        return true;
      });
  });

  test('승인 뒤: 같은 탭 · 주소 · 지문이면 실제 마우스로 누르고, 뜬 뒤의 화면과 주소를 남긴다', async () => {
    const tab = await filled('/form?c');
    const held = await pages.hold(tab, publish, signal());
    const before = posts.length;
    const result = await pages.press(
      { tabId: tab.id, pageUrl: held.pageUrl, button: publish, fingerprint: held.fingerprint },
      signal(),
    );
    assert.equal(result.outcome, 'clicked', String(result.reason));
    assert.equal(result.afterUrl, `${url}/done`);
    assert.ok(result.image);
    assert.deepEqual(
      posts.slice(before),
      ['title=%EC%8B%9C%ED%97%98+%EA%B8%80'],
      '채운 값이 한 번 갔다',
    );
  });

  test('승인 전에 페이지가 바뀌었으면 누르지 않는다: 버튼이 다름 · 주소가 다름 · 탭이 닫힘', async () => {
    const before = posts.length;
    const changedButton = await filled('/form?d');
    const held = await pages.hold(changedButton, publish, signal());
    await run(changedButton, "document.querySelector('form').action = '/elsewhere'");
    const one = await pages.press(
      {
        tabId: changedButton.id,
        pageUrl: held.pageUrl,
        button: publish,
        fingerprint: held.fingerprint,
      },
      signal(),
    );
    assert.deepEqual([one.outcome, one.reason], ['changed', '버튼이 달라요']);
    assert.ok(one.image, '그때의 화면을 남긴다');

    const moved = await filled('/form?e');
    const heldMoved = await pages.hold(moved, publish, signal());
    await run(moved, "history.pushState({}, '', '/form?other')");
    const two = await pages.press(
      {
        tabId: moved.id,
        pageUrl: heldMoved.pageUrl,
        button: publish,
        fingerprint: heldMoved.fingerprint,
      },
      signal(),
    );
    assert.deepEqual([two.outcome, two.reason], ['changed', '주소가 달라요']);

    const closed = await filled('/form?f');
    const heldClosed = await pages.hold(closed, publish, signal());
    await fetch(`${chromium.endpoint}/json/close/${closed.id}`);
    await pause(300);
    const three = await pages.press(
      {
        tabId: closed.id,
        pageUrl: heldClosed.pageUrl,
        button: publish,
        fingerprint: heldClosed.fingerprint,
      },
      signal(),
    );
    assert.deepEqual([three.outcome, three.reason], ['changed', '탭이 닫혔어요']);
    assert.equal(posts.length, before, '어느 경우에도 사이트에 요청이 가지 않았다');
  });

  test('브라우저에 닿지 못하면 누르지 않는다', async () => {
    const none = new BrowserPages('http://127.0.0.1:1');
    const result = await none.press(
      { tabId: 'X', pageUrl: `${url}/form`, button: publish, fingerprint: 'a'.repeat(64) },
      signal(),
    );
    assert.equal(result.outcome, 'changed');
    assert.match(String(result.reason), /브라우저에 닿지 못해 누르지 않았어요/);
  });
});
