import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { Backoff } from './backoff';
import { Redactor, RunLog } from './redactor';
import { ServerPairing } from './server-pairing';

// 서버 러너의 연결: 연결 값 파일을 내밀고 토큰을 받는다. 가짜 서버가 차례로 답한다.

let dir: string;
let server: Server;
let url: string;
/** 가짜 서버가 차례로 돌려줄 답 [상태, 본문]. 다 쓰면 마지막 것을 되풀이한다 */
let replies: [number, object][] = [];
const seen: string[] = [];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cairn-pairing-'));
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push(`${req.method} ${req.url} ${body}`);
      const [status, reply] =
        replies.length > 1 ? (replies.shift() ?? [500, {}]) : (replies[0] ?? [500, {}]);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

function pairing(file: string): ServerPairing {
  return new ServerPairing(url, file, new RunLog(new Redactor([])), new Backoff(5, 20));
}

describe('서버 러너 연결 (ServerPairing)', () => {
  test('연결 값을 내밀어 토큰을 받는다. 설치 전(409)이면 기다렸다 다시 묻는다', async () => {
    const file = join(dir, 'pairing');
    writeFileSync(file, 'the-secret\n');
    seen.length = 0;
    replies = [
      [409, { code: 'conflict', message: '설치가 끝나면 서버 러너가 연결돼요' }],
      [200, { id: 'd1', token: 'cairn_dt_new' }],
    ];
    const token = await pairing(file).token(new AbortController().signal);
    assert.equal(token, 'cairn_dt_new');
    assert.equal(seen.length, 2);
    assert.equal(seen[0], 'POST /api/devices/server-runner {"secret":"the-secret"}');
  });

  test('파일이 아직 없으면 생길 때까지 기다리고, 403이면 파일을 다시 읽는다', async () => {
    const file = join(dir, 'later');
    seen.length = 0;
    replies = [
      [403, { code: 'forbidden', message: '서버 러너의 연결 값이 맞지 않아요' }],
      [200, { id: 'd1', token: 'cairn_dt_after' }],
    ];
    setTimeout(() => writeFileSync(file, 'old'), 30);
    setTimeout(() => writeFileSync(file, 'new'), 60);
    const token = await pairing(file).token(new AbortController().signal);
    assert.equal(token, 'cairn_dt_after');
    assert.match(seen.at(-1) ?? '', /"secret":"(old|new)"/);
  });

  test('멈추라고 하면 토큰 없이 null', async () => {
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 30);
    assert.equal(await pairing(join(dir, 'never')).token(stop.signal), null);
  });
});
