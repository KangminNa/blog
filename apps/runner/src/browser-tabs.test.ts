import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { BrowserTabs, TabUnreadable } from './browser-tabs';
import { TestChromium } from './testing/test-chromium';

// 실제 Chromium으로 CDP 흐름을 본다: 새 탭 → 다 뜨면 제목과 보이는 글자 → 탭 닫기.
// Chromium이 없으면 건너뛴다 (CAIRN_TEST_CHROMIUM으로 경로를 줄 수 있다).
const { skip } = TestChromium;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>탭 시험</title></head><body>
<h1>보이는 글자</h1><p style="display:none">숨은 글자</p><div id="late"></div>
<script>setTimeout(() => { document.getElementById('late').textContent = '나중에 그린 글자'; }, 300);</script>
</body></html>`;

let chromium: TestChromium;
let site: Server;
let siteUrl: string;
let endpoint: string;

before(async () => {
  if (skip) return;
  site = createServer((_, res) =>
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE),
  );
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}/page`;
  chromium = await TestChromium.start();
  endpoint = chromium.endpoint;
});

after(async () => {
  if (skip) return;
  await chromium.stop();
  site.close();
});

describe('BrowserTabs (실제 Chromium)', { skip }, () => {
  test('새 탭으로 열어 제목과 보이는 글자를 읽고, 그 탭을 닫는다', async () => {
    const tabs = new BrowserTabs(endpoint);
    const stop = new AbortController().signal;
    const read = await tabs.read(siteUrl, stop);
    assert.equal(read.title, '탭 시험');
    assert.match(read.body, /보이는 글자/);
    assert.match(read.body, /나중에 그린 글자/, '다 뜬 뒤 그려진 글자까지');
    assert.doesNotMatch(read.body, /숨은 글자/, '보이지 않는 글자는 빼고');
    assert.equal((await chromium.openUrls()).includes(siteUrl), false, '읽은 탭은 닫는다');
    assert.equal(
      getEventListeners(stop, 'abort').length,
      0,
      '러너의 stop에 리스너를 남기지 않는다',
    );
  });

  test('http · https가 아닌 주소, 열리지 않는 주소, 닿지 않는 브라우저는 TabUnreadable', async () => {
    const stop = new AbortController().signal;
    await assert.rejects(new BrowserTabs(endpoint).read('file:///etc/passwd', stop), TabUnreadable);
    await assert.rejects(
      new BrowserTabs(endpoint).read('http://127.0.0.1:1/', stop),
      /열지 못했어요/,
    );
    await assert.rejects(
      new BrowserTabs('http://127.0.0.1:1').read(siteUrl, stop),
      /닿지 못했어요/,
    );
  });
});
