import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { BlobStore } from './blob-store';
import { Database } from './database';
import { NotFound, RuleViolation, TooLarge } from './errors';
import { FileSniff } from './file-sniff';

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

  test('흘려 받아 저장한다: save와 같은 해시 · 크기, mime은 조각으로 나뉜 앞부분으로 정한다', async () => {
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(`본문 ${Date.now()}`)]);
    const pieces = async function* () {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
    };
    const heads: Buffer[] = [];
    const blob = await store.saveStream(pieces(), 1024, (head) => {
      heads.push(head);
      return FileSniff.mimeOf(head) ?? 'application/octet-stream';
    });
    assert.equal(blob.hash, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(blob.size, bytes.length);
    assert.equal(blob.mime, 'application/pdf');
    assert.equal(heads[0]?.length, FileSniff.HEAD_BYTES);
    assert.deepEqual(await read(blob.hash), bytes);
  });

  test('한도를 넘거나 해시가 다르면 거절하고 파일도 행도 남기지 않는다', async () => {
    const bytes = Buffer.from(`넘치는 내용 ${Date.now()}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const once = async function* () {
      yield bytes;
    };
    const octet = () => 'application/octet-stream';
    await assert.rejects(store.saveStream(once(), bytes.length - 1, octet), TooLarge);
    await assert.rejects(
      store.saveStream(once(), bytes.length, octet, '0'.repeat(64)),
      RuleViolation,
    );
    assert.equal(await store.find(hash), null);
    const files = await readdir(dir);
    assert.equal(files.includes(hash), false);
    assert.equal(files.filter((f) => f.endsWith('.tmp')).length, 0);
    // 딱 한도이고 해시가 맞으면 저장한다
    assert.equal((await store.saveStream(once(), bytes.length, octet, hash)).hash, hash);
  });

  test('디스크에 남은 바이트를 안다', async () => {
    assert.ok((await store.freeBytes()) > 0);
  });

  test('없는 해시는 NotFound', async () => {
    await assert.rejects(store.open('0'.repeat(64)), NotFound);
    assert.equal(await store.find('0'.repeat(64)), null);
  });
});
