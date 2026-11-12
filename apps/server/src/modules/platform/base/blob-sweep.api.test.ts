import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type TestUser } from '../../../testing/api-client';
import { SystemActor } from './actor';
import { BlobStore } from './blob-store';
import { Database } from './database';

// 쓰지 않는 파일 지우기 (BlobStore.sweep): 서버를 띄워 모듈이 모두 등록한 상태로 본다.
// 모듈은 파일을 값으로만 가리켜 DB가 지켜 주지 않는다. 등록을 빠뜨린 칸이 있으면 그 칸의 파일이 지워지므로 여기서 막는다.

const DAY = 24 * 60 * 60 * 1000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let api: ApiClient;
let owner: TestUser;
let dir: string;
let store: BlobStore;
let db: Database;

/** 이 파일을 8일 전에 저장한 것으로 */
const age = (hash: string) =>
  db.sql`UPDATE platform.blobs SET created_at = now() - interval '8 days' WHERE hash = ${hash}`;
const sweep = () => store.sweep(new SystemActor(), new Date(Date.now() - 7 * DAY));
const onDisk = async (hash: string) => (await readdir(dir)).includes(hash);

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cairn-sweep-test-'));
  process.env.CAIRN_BLOBS_DIR = dir;
  api = await ApiClient.start();
  owner = await api.signIn();
  store = api.service(BlobStore);
  db = api.service(Database);
});

after(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

describe('쓰지 않는 파일 지우기', () => {
  test('DB에서 파일을 가리키는 칸(*blob_hash)은 모두 등록돼 있다', async () => {
    const rows = await db.sql`
      SELECT table_schema || '.' || table_name || '.' || column_name AS name
        FROM information_schema.columns
       WHERE column_name LIKE '%blob_hash' AND table_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY 1`;
    // 해시를 jsonb 목록 안에 두는 칸(이름이 blob_hash로 끝나지 않는다)은 이 물음에 나오지 않아 따로 적는다
    const inJson = ['blog.page_revisions.files'];
    assert.deepEqual(
      [...rows.map((row) => String(row.name)), ...inJson].sort(),
      [...store.usedColumns].sort(),
      '새 칸은 그 모듈의 onModuleInit에서 BlobStore.registerUse로 등록한다',
    );
  });

  test('아무도 가리키지 않는 오래된 파일만 지운다. 글의 사진과 새 파일은 남는다', async () => {
    const created = await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title: `사진 글 ${randomUUID()}`,
    });
    assert.equal(created.status, 201, created.text);
    const post = created.json() as { id: string };
    const res = await fetch(`${api.baseUrl}/api/posts/${post.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', cookie: owner.header ?? '' },
      body: Buffer.concat([PNG, randomBytes(32)]),
    });
    assert.equal(res.status, 201);
    const photo = ((await res.json()) as { hash: string }).hash;

    const orphan = (await store.save(randomBytes(64), 'application/octet-stream')).hash;
    const fresh = (await store.save(randomBytes(64), 'application/octet-stream')).hash;
    await age(photo);
    await age(orphan);

    assert.ok((await sweep()) >= 1);
    assert.equal(await store.find(orphan), null);
    assert.equal(await onDisk(orphan), false);
    assert.notEqual(await store.find(photo), null, '글의 사진');
    assert.equal(await onDisk(photo), true);
    assert.notEqual(await store.find(fresh), null, '7일이 안 된 파일');
  });

  test('오래된 파일도 다시 저장하면 기다림이 처음부터다', async () => {
    const bytes = randomBytes(64);
    const hash = (await store.save(bytes, 'application/octet-stream')).hash;
    await age(hash);
    await store.save(bytes, 'application/octet-stream');
    await sweep();
    assert.notEqual(await store.find(hash), null);
    assert.equal(await onDisk(hash), true);
  });
});
