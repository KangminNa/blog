import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { BrowserScreenGateway } from './screen.gateway';

// 사이트 세션 지우기 (2026-11-14)를 진짜 Chromium으로 본다: 그 사이트 호스트의 쿠키와 그 출처의 저장소만 지우고,
// 다른 사이트의 로그인(쿠키 · localStorage)은 그대로 둔다. Chromium이 없으면 건너뛴다 (CAIRN_TEST_CHROMIUM).
// 쿠키는 포트를 가리지 않아서 두 사이트는 호스트 이름이 다르다 (127.0.0.1 · localhost).

const CHROMIUM = process.env.CAIRN_TEST_CHROMIUM ?? '/opt/pw-browsers/chromium';
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

let chrome: ChildProcess;
let profile: string;
let port: number;
let site: Server;
let sitePort: number;

/** 탭 하나에서 식 하나를 돌린다 */
async function evaluate(tab: string, expression: string): Promise<unknown> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${tab}`);
  await new Promise((done) => socket.addEventListener('open', done, { once: true }));
  const reply = await new Promise<{ result?: { result?: { value?: unknown } } }>((done) => {
    socket.addEventListener('message', (e) => done(JSON.parse(String(e.data))), { once: true });
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }),
    );
  });
  socket.close();
  return reply.result?.result?.value;
}

/** 주소를 새 탭으로 열어 다 뜰 때까지 기다린다 */
async function open(url: string): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' });
  const { id } = (await res.json()) as { id: string };
  for (let i = 0; i < 50; i++) {
    if ((await evaluate(id, 'document.readyState')) === 'complete') break;
    await pause(100);
  }
  return id;
}

describe('사이트 세션 지우기 (진짜 Chromium)', {
  skip: !existsSync(CHROMIUM) && `Chromium이 없어요: ${CHROMIUM}`,
}, () => {
  before(async () => {
    site = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      // 들어오면 로그인한 것처럼 쿠키 하나와 저장소 토큰 하나
      res.setHeader('set-cookie', `sid=${req.headers.host}; Path=/; Max-Age=3600`);
      res.end('<script>localStorage.setItem("token", location.host)</script>로그인됨');
    });
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    sitePort = (site.address() as AddressInfo).port;
    profile = mkdtempSync(join(tmpdir(), 'cairn-session-'));
    chrome = spawn(
      CHROMIUM,
      [
        '--headless=new',
        '--no-sandbox',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore', detached: true },
    );
    const file = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(file); i++) await pause(100);
    port = Number(readFileSync(file, 'utf8').split('\n')[0]);
  });

  after(async () => {
    const exited = new Promise((done) => chrome.once('exit', done));
    if (chrome.pid) process.kill(-chrome.pid, 'SIGKILL');
    await exited;
    site.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  test('그 사이트의 쿠키 · localStorage만 지우고, 다른 사이트의 로그인은 남는다', async () => {
    const mine = `http://127.0.0.1:${sitePort}`;
    const theirs = `http://localhost:${sitePort}`;
    const a = await open(`${mine}/`);
    const b = await open(`${theirs}/`);
    assert.match(String(await evaluate(a, 'document.cookie')), /sid=/);
    assert.match(String(await evaluate(b, 'document.cookie')), /sid=/);

    const blanks = async () => {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      return ((await res.json()) as { url: string }[]).filter((t) => t.url === 'about:blank')
        .length;
    };
    const before = await blanks();
    const screen = new BrowserScreenGateway('127.0.0.1', port);
    assert.equal(await screen.clearSite([mine]), 1, '지운 쿠키 수');

    assert.equal(await evaluate(a, 'document.cookie'), '', '그 사이트의 쿠키는 지운다');
    assert.equal(await evaluate(a, 'localStorage.getItem("token")'), null, '저장소의 토큰도');
    assert.match(
      String(await evaluate(b, 'document.cookie')),
      /sid=localhost/,
      '다른 사이트의 쿠키는 그대로',
    );
    assert.equal(
      await evaluate(b, 'localStorage.getItem("token")'),
      `localhost:${sitePort}`,
      '다른 사이트의 저장소도 그대로',
    );
    assert.equal(await blanks(), before, '쓰려고 연 빈 탭은 닫는다');
  });
});
