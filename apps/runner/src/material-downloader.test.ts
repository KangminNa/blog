import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { CairnServer } from './cairn-server';
import { MaterialBroken, MaterialDownloader, MaterialGone } from './material-downloader';
import { ToolRefused } from './mcp-client';

// 재료 결과물 받기: 표를 받고 → 표의 주소에서 받으며 크기 · sha256을 맞춘다. 서버는 이 시험의 작은 HTTP 서버다.

const TASK = '00000000-0000-7000-8000-0000000000a1';
const OUT = '00000000-0000-7000-8000-0000000000b1';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** 표의 토큰마다 내줄 것: 본문, 또는 상태 코드 */
const served = new Map<string, Buffer | number>();
let http: Server;
let url: string;
let dir: string;

/** begin_download 흉내: 이름 · 크기 · 해시를 표에 적고 토큰으로 본문을 고른다 */
function serverWith(
  ticket: { name: string; body: Buffer | number; size?: number; sha256?: string } | Error,
): CairnServer {
  return {
    async beginDownload() {
      if (ticket instanceof Error) throw ticket;
      const token = `t${served.size}`;
      served.set(token, ticket.body);
      const bytes = typeof ticket.body === 'number' ? Buffer.alloc(0) : ticket.body;
      return {
        path: '/api/outputs/download',
        header: 'x-cairn-download',
        token,
        name: ticket.name,
        size: ticket.size ?? bytes.length,
        sha256: ticket.sha256 ?? sha(bytes),
      };
    },
  } as unknown as CairnServer;
}

before(async () => {
  http = createServer((req, res) => {
    const body = served.get(String(req.headers['x-cairn-download']));
    if (body === undefined) return res.writeHead(403).end();
    if (typeof body === 'number') return res.writeHead(body).end();
    res.writeHead(200).end(body);
  });
  await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

after(() => http.close());

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'material-'));
  return async () => rm(dir, { recursive: true, force: true });
});

describe('재료 받기', () => {
  test('받으며 크기 · sha256을 맞추고, 같은 이름은 번호를 붙인다', async () => {
    const body = Buffer.from('발표 재료');
    const downloader = new MaterialDownloader(serverWith({ name: '표지.png', body }), url);
    const first = await downloader.download(TASK, OUT, dir);
    const second = await downloader.download(TASK, OUT, dir);
    assert.deepEqual([first.name, first.size], ['표지.png', body.length]);
    assert.equal(second.name, '표지 (2).png');
    assert.deepEqual(await readFile(join(dir, '표지.png')), body);
  });

  test('이름에 폴더 · 숨김 · 제어 문자가 있으면 재료-<id>로 받는다', async () => {
    for (const name of ['../밖.txt', '.bashrc', 'a\nb']) {
      const downloader = new MaterialDownloader(serverWith({ name, body: Buffer.from('x') }), url);
      const file = await downloader.download(TASK, OUT, dir);
      assert.equal(file.name, `재료-${OUT.slice(0, 8)}`, name);
      await rm(join(dir, file.name));
    }
  });

  test('표와 다르면 파일을 남기지 않고 실패, 휴지통에 갔으면 그 재료만 뺀다', async () => {
    const wrongHash = serverWith({ name: 'a.bin', body: Buffer.from('x'), sha256: '0'.repeat(64) });
    await assert.rejects(
      new MaterialDownloader(wrongHash, url).download(TASK, OUT, dir),
      MaterialBroken,
    );
    const tooBig = serverWith({ name: 'b.bin', body: Buffer.from('xyz'), size: 1 });
    await assert.rejects(
      new MaterialDownloader(tooBig, url).download(TASK, OUT, dir),
      MaterialBroken,
    );
    assert.deepEqual(await readdir(dir), []);

    const trashed = serverWith({ name: 'c.bin', body: 404 });
    await assert.rejects(
      new MaterialDownloader(trashed, url).download(TASK, OUT, dir),
      MaterialGone,
    );
    const gone = serverWith(new ToolRefused('not_found', '없거나 휴지통에 있는 결과물이에요'));
    await assert.rejects(new MaterialDownloader(gone, url).download(TASK, OUT, dir), MaterialGone);
    const refused = serverWith(new ToolRefused('forbidden', '이 작업의 재료가 아닌 결과물이에요'));
    await assert.rejects(
      new MaterialDownloader(refused, url).download(TASK, OUT, dir),
      MaterialBroken,
    );
  });
});
