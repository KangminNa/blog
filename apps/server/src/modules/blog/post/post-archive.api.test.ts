import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { ArchiveQuery, SystemActor } from '../../platform';

// 백업 zip의 사진: 실제로 올린 파일이 zip 안에서 바이트까지 같은지 본다 (docs/보관형식.md의 assets/).

type Json = Record<string, unknown>;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF = Buffer.from('GIF89a', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.alloc(4),
  Buffer.from('WEBP', 'latin1'),
]);

let api: ApiClient;
let owner: TestUser;
let blobs: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 내용이 매번 다른 사진 (앞부분만 맞으면 된다. 서버는 그림을 풀지 않는다) */
const photo = (head: Buffer = PNG): Buffer => Buffer.concat([head, randomBytes(256)]);
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function newPost(): Promise<Json> {
  return ok(
    await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title: `사진 보관 ${randomUUID()}`,
    }),
    201,
  );
}

async function upload(post: Json, bytes: Buffer): Promise<void> {
  const res = await fetch(`${api.baseUrl}/api/posts/${post.id}/assets`, {
    method: 'POST',
    headers: { 'content-type': 'image/png', cookie: owner.header }, // 형식은 파일의 앞부분으로 정한다
    body: new Uint8Array(bytes),
  });
  assert.equal(res.status, 201, await res.text());
}

/** zip의 파일을 차례로 읽는다. 같은 이름이 두 번 나오면 두 번 담긴다 */
function unzip(zip: Buffer): [string, Buffer][] {
  const found: [string, Buffer][] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const extra = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extra;
    found.push([name, inflateRawSync(zip.subarray(start, start + size))]);
    at = start + size;
  }
  return found;
}

async function backup(): Promise<[string, Buffer][]> {
  const res = await fetch(`${api.baseUrl}/api/archive.zip`, { headers: { cookie: owner.header } });
  assert.equal(res.status, 200);
  return unzip(Buffer.from(await res.arrayBuffer()));
}

const inZip = (files: [string, Buffer][], path: string): Buffer[] =>
  files.filter(([name]) => name === path).map(([, body]) => body);

before(async () => {
  blobs = await mkdtemp(join(tmpdir(), 'cairn-archive-test-'));
  process.env.CAIRN_BLOBS_DIR = blobs;
  api = await ApiClient.start();
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
});

after(async () => {
  await api.close();
  await rm(blobs, { recursive: true, force: true });
});

describe('백업 zip의 사진', () => {
  test('방문자는 받을 수 없다', async () => {
    assert.equal((await fetch(`${api.baseUrl}/api/archive.zip`)).status, 403);
    assert.equal((await api.get('/api/archive.zip', TestUser.visitor)).status, 403);
  });

  test('올린 사진이 assets/<해시>.png로 들어가고 바이트까지 같다', async () => {
    const bytes = photo();
    await upload(await newPost(), bytes);
    const [body] = inZip(await backup(), `assets/${sha256(bytes)}.png`);
    assert.ok(body, '사진이 zip에 없다');
    assert.deepEqual(body, bytes);
  });

  test('확장자는 형식을 따른다', async () => {
    const post = await newPost();
    const kinds: [Buffer, string][] = [
      [photo(JPEG), 'jpg'],
      [photo(WEBP), 'webp'],
      [photo(GIF), 'gif'],
    ];
    for (const [bytes] of kinds) await upload(post, bytes);
    const files = await backup();
    for (const [bytes, extension] of kinds)
      assert.deepEqual(inZip(files, `assets/${sha256(bytes)}.${extension}`), [bytes]);
  });

  test('두 글에 붙은 사진도 한 번만 들어간다', async () => {
    const bytes = photo();
    await upload(await newPost(), bytes);
    await upload(await newPost(), bytes);
    assert.equal(inZip(await backup(), `assets/${sha256(bytes)}.png`).length, 1);
  });

  test('휴지통 글의 사진은 빠지고, 다른 글에도 붙어 있으면 남는다', async () => {
    const only = photo();
    const shared = photo();
    const trashed = await newPost();
    const kept = await newPost();
    await upload(trashed, only);
    await upload(trashed, shared);
    await upload(kept, shared);
    ok(
      await api.request('DELETE', `/api/posts/${trashed.id}`, owner, { version: trashed.version }),
    );

    const files = await backup();
    assert.deepEqual(inZip(files, `assets/${sha256(only)}.png`), []);
    assert.deepEqual(inZip(files, `assets/${sha256(shared)}.png`), [shared]);
  });

  test('디스크에 없는 사진은 빼고 나머지로 백업을 만든다', async () => {
    const missing = photo();
    const present = photo();
    const post = await newPost();
    await upload(post, missing);
    await upload(post, present);
    await rm(join(blobs, sha256(missing)));

    const files = await backup();
    assert.deepEqual(inZip(files, `assets/${sha256(missing)}.png`), []);
    assert.deepEqual(inZip(files, `assets/${sha256(present)}.png`), [present]);
    assert.equal(
      files.some(([name, body]) => name.endsWith('.md') && body.includes(String(post.id))),
      true,
      '글은 그대로 들어간다',
    );
  });

  test('공개 글과 그 사진만 공개 저장소로 나갈 수 있다', async () => {
    const draft = await newPost();
    const open = await newPost();
    const draftOnly = Buffer.concat([PNG, Buffer.from(randomUUID())]);
    const shown = Buffer.concat([PNG, Buffer.from(randomUUID())]);
    await upload(draft, draftOnly);
    await upload(open, shown);
    const { version } = open;
    const res = await api.request('POST', `/api/posts/${open.id}/status`, owner, {
      status: 'published',
      version,
    });
    assert.equal(res.status, 200, res.text);

    const files = await api.service(ArchiveQuery).files(new SystemActor());
    const privateOf = (bytes: Buffer) =>
      files.find((f) => f.path.startsWith('assets/') && f.body.equals(bytes))?.isPrivateArea();
    const postOf = (slug: unknown) =>
      files.find((f) => f.path.endsWith(`/${slug}.md`))?.isPrivateArea();
    assert.equal(privateOf(draftOnly), true);
    assert.equal(privateOf(shown), false);
    assert.equal(postOf(draft.slug), true);
    assert.equal(postOf(open.slug), false);
  });

  test('동기화 플러그인의 길(공간 없는 SystemActor)로도 사진이 나온다', async () => {
    const bytes = photo();
    await upload(await newPost(), bytes);
    const files = await api.service(ArchiveQuery).files(new SystemActor());
    const path = `assets/${sha256(bytes)}.png`;
    assert.deepEqual(files.find((f) => f.path === path)?.body, bytes);
  });
});
