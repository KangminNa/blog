import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { BlobStore } from './blob-store';
import { Database } from './database';
import { NotFound } from './errors';

// 파일 저장소를 실제 디스크와 DB로 확인한다.

const db = new Database();
let dir: string;
let store: BlobStore;

async function read(hash: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await store.open(hash)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cairn-blobs-'));
  process.env.CAIRN_BLOBS_DIR = dir;
  store = new BlobStore(db);
});

after(async () => {
  await db.sql`DELETE FROM platform.blobs WHERE hash = ANY(${await readdir(dir)})`;
  await rm(dir, { recursive: true, force: true });
  await db.onApplicationShutdown();
});

describe('BlobStore', () => {
  test('저장한 내용을 해시로 읽는다. 이름은 내용의 sha256', async () => {
    const bytes = Buffer.from(`읽을 내용 ${Date.now()}`);
    const blob = await store.save(bytes, 'image/png');
    assert.match(blob.hash, /^[0-9a-f]{64}$/);
    assert.equal(blob.mime, 'image/png');
    assert.equal(blob.size, bytes.length);
    assert.deepEqual(await read(blob.hash), bytes);
    assert.equal((await store.find(blob.hash))?.mime, 'image/png');
  });

  test('같은 내용은 몇 번을 저장해도 파일 하나, 행 하나. 임시 파일이 남지 않는다', async () => {
    const bytes = Buffer.from(`겹치는 내용 ${Date.now()}`);
    const [a, b] = await Promise.all([
      store.save(bytes, 'image/png'),
      store.save(bytes, 'image/png'),
    ]);
    const again = await store.save(bytes, 'image/png');
    assert.equal(a.hash, b.hash);
    assert.equal(a.hash, again.hash);
    const rows = await db.sql`SELECT 1 FROM platform.blobs WHERE hash = ${a.hash}`;
    assert.equal(rows.length, 1);
    const files = await readdir(dir);
    assert.equal(files.filter((f) => f === a.hash).length, 1);
    assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0);
  });

  test('해시 모양이 아니면 디스크에 닿지 않고 거절한다', async () => {
    for (const bad of [
      '../../etc/passwd',
      '..',
      '',
      'a'.repeat(63),
      'A'.repeat(64),
      `${'a'.repeat(64)}/x`,
      `${'a'.repeat(64)}\n`,
    ]) {
      await assert.rejects(store.open(bad), NotFound, JSON.stringify(bad));
      assert.equal(await store.find(bad), null);
    }
  });

  test('없는 해시는 NotFound', async () => {
    await assert.rejects(store.open('0'.repeat(64)), NotFound);
    assert.equal(await store.find('0'.repeat(64)), null);
  });
});
