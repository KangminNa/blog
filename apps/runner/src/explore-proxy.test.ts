import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { ExploreProxy } from './explore-proxy';

// 둘러보기의 나가는 길: 이름을 풀어 본 주소로만 붙고, 이 서버 · 내부망 · 메타데이터 주소는 막는다 (http · CONNECT 모두).
// 진짜 Chromium + Playwright MCP로 하는 시험은 browser-mcp.test.ts.

let site: Server;
let sitePort: number;
let hits = 0;

before(async () => {
  site = createServer((_, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'text/plain' }).end('공개 페이지');
  });
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
  sitePort = (site.address() as AddressInfo).port;
});
after(() => {
  site.closeAllConnections();
  site.close();
});

/** 프록시로 http 주소 하나를 받는다 */
function viaProxy(proxy: ExploreProxy, url: string): Promise<{ status: number; body: string }> {
  const { port } = new URL(proxy.url);
  return new Promise((done, fail) => {
    const req = request(
      { host: '127.0.0.1', port, path: url, headers: { host: new URL(url).host } },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => done({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', fail);
    req.end();
  });
}

/** CONNECT로 터널을 열고, 열리면 그 안으로 http 요청 하나를 보낸다 */
function tunnel(proxy: ExploreProxy, target: string): Promise<{ status: number; body: string }> {
  const { port } = new URL(proxy.url);
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method: 'CONNECT', path: target });
    req.on('connect', (res, socket: Socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return done({ status: res.statusCode ?? 0, body: '' });
      }
      let body = '';
      socket.on('data', (c) => {
        body += c;
      });
      socket.on('end', () => done({ status: 200, body }));
      socket.write(`GET / HTTP/1.1\r\nHost: ${target}\r\nConnection: close\r\n\r\n`);
    });
    req.on('error', fail);
    req.end();
  });
}

describe('둘러보기 프록시', () => {
  test('내부 주소: 사설 · 루프백 · 링크 로컬(메타데이터) · CGNAT · IPv6 내부와 IPv4를 담은 IPv6', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.18.0.2',
      '192.168.1.1',
      '169.254.169.254',
      '100.100.1.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      assert.equal(ExploreProxy.internal(ip), true, ip);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])
      assert.equal(ExploreProxy.internal(ip), false, ip);
  });

  test('기본 규칙: 이 서버(루프백) · localhost로는 http도 터널도 막는다', async () => {
    const proxy = await ExploreProxy.start();
    try {
      const before = hits;
      const http = await viaProxy(proxy, `http://127.0.0.1:${sitePort}/`);
      assert.equal(http.status, 403);
      assert.match(http.body, /막힌 주소/);
      assert.equal((await viaProxy(proxy, `http://localhost:${sitePort}/`)).status, 403);
      assert.equal((await tunnel(proxy, `127.0.0.1:${sitePort}`)).status, 403);
      assert.equal((await tunnel(proxy, `localhost:${sitePort}`)).status, 403);
      assert.equal(
        (await viaProxy(proxy, 'http://no-such-host.invalid/')).status,
        403,
        '풀리지 않는 이름',
      );
      assert.equal(hits, before, '막힌 주소에는 요청이 가지 않았다');
    } finally {
      await proxy.close();
    }
  });

  test('막지 않는 주소는 그대로 넘긴다 (http · 터널)', async () => {
    const proxy = await ExploreProxy.start((_, port) => port !== sitePort);
    try {
      const http = await viaProxy(proxy, `http://127.0.0.1:${sitePort}/`);
      assert.deepEqual(http, { status: 200, body: '공개 페이지' });
      const through = await tunnel(proxy, `127.0.0.1:${sitePort}`);
      assert.equal(through.status, 200);
      assert.match(through.body, /공개 페이지/);
    } finally {
      await proxy.close();
    }
  });
});
