import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ApiClient, ApiResult, TestUser } from '../../../testing/api-client';
import { OutboxWorker } from '../../platform';

// 사진: 주인이 글에 올리고, 공개·링크 공개 글의 사진은 누구나 본다. 임시·휴지통 글의 사진은 방문자에게 없는 파일과 같다.
// 올리는 본문은 JSON이 아니라 파일 그대로라 fetch로 직접 보낸다.

const LIMIT = 10 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

let api: ApiClient;
let owner: TestUser;
let blobs: string;
/** read_all · write 권한을 준 기기 */
let device: string;

type Saved = { id: string; version: number };
type Uploaded = { hash: string; url: string; mime: string; size: number };

/** 내용이 매번 다른 PNG (앞부분만 PNG면 된다. 서버는 그림을 풀지 않는다) */
const png = (size = 32) => Buffer.concat([PNG, randomBytes(size)]);

async function upload(
  postId: string,
  body: Buffer | string,
  type: string,
  as: TestUser = owner,
): Promise<ApiResult> {
  const res = await fetch(`${api.baseUrl}/api/posts/${postId}/assets`, {
    method: 'POST',
    headers: { 'content-type': type, ...(as.header ? { cookie: as.header } : {}) },
    body,
  });
  return new ApiResult(res.status, await res.text(), res.headers);
}

async function newPost(status?: string): Promise<Saved> {
  const res = await api.request('POST', '/api/posts', owner, {
    requestId: randomUUID(),
    title: `사진 글 ${randomUUID()}`,
  });
  assert.equal(res.status, 201, res.text);
  const post = res.json() as Saved;
  return status ? setStatus(post, status) : post;
}

async function setStatus(post: Saved, status: string): Promise<Saved> {
  const res = await api.request('POST', `/api/posts/${post.id}/status`, owner, {
    version: post.version,
    status,
  });
  assert.equal(res.status, 200, res.text);
  return res.json() as Saved;
}

async function photoOf(post: Saved, body = png()): Promise<Uploaded> {
  const res = await upload(post.id, body, 'image/png');
  assert.equal(res.status, 201, res.text);
  return res.json() as unknown as Uploaded;
}

before(async () => {
  blobs = await mkdtemp(join(tmpdir(), 'cairn-asset-test-'));
  process.env.CAIRN_BLOBS_DIR = blobs;
  api = await ApiClient.start();
  owner = await api.signIn();
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  device = await api.connectDevice(owner, 'asset-device');
  const { devices } = (await api.get('/api/devices', owner)).json() as {
    devices: { id: string; name: string; version: number }[];
  };
  const found = devices.find((d) => d.name === 'asset-device');
  const patched = await api.request('PATCH', `/api/devices/${found?.id}`, owner, {
    scopes: ['read_all', 'write'],
    version: found?.version,
  });
  assert.equal(patched.status, 200, patched.text);
});

after(async () => {
  // 다음 테스트 파일이 받는 이벤트가 밀리지 않게 이 파일이 남긴 이벤트를 치운다
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
  await rm(blobs, { recursive: true, force: true });
});

describe('사진 올리기 (POST /api/posts/:id/assets)', () => {
  test('주인: 올리면 해시, 본문에 넣을 주소, 형식, 크기를 돌려준다', async () => {
    const post = await newPost();
    const bytes = png();
    const res = await upload(post.id, bytes, 'image/png');
    assert.equal(res.status, 201, res.text);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual(res.json(), {
      hash,
      url: `/api/files/${hash}`,
      mime: 'image/png',
      size: bytes.length,
    });
  });

  test('같은 사진을 다시 올려도 결과가 같다', async () => {
    const post = await newPost();
    const bytes = png();
    const first = await photoOf(post, bytes);
    const again = await photoOf(post, bytes);
    assert.deepEqual(again, first);
  });

  test('방문자는 올릴 수 없다', async () => {
    const post = await newPost();
    const res = await upload(post.id, png(), 'image/png', TestUser.visitor);
    assert.equal(res.status, 403);
  });

  test('기기는 write 권한이 있어도 올릴 수 없다', async () => {
    const post = await newPost();
    const res = await fetch(`${api.baseUrl}/api/posts/${post.id}/assets`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', authorization: `Bearer ${device}` },
      body: png(),
    });
    assert.equal(res.status, 403);
  });

  test('없는 글·휴지통 글은 404', async () => {
    assert.equal((await upload(randomUUID(), png(), 'image/png')).status, 404);
    const post = await newPost();
    const trashed = await api.request('DELETE', `/api/posts/${post.id}`, owner, {
      version: post.version,
    });
    assert.equal(trashed.status, 200, trashed.text);
    assert.equal((await upload(post.id, png(), 'image/png')).status, 404);
  });

  test('형식은 머리글이 아니라 파일의 앞부분으로 정한다', async () => {
    const post = await newPost();
    const res = await upload(post.id, png(), 'image/gif');
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json().mime, 'image/png');
    const gif = await upload(post.id, Buffer.from(`GIF89a${randomUUID()}`), 'image/png');
    assert.equal(gif.status, 201, gif.text);
    assert.equal(gif.json().mime, 'image/gif');
  });

  test('이미지 본문은 사진 올리기 주소에서만 읽는다', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    const res = await fetch(`${api.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: big,
    });
    assert.notEqual(res.status, 413);
  });

  test('한도: 10MB는 받고, 1바이트라도 넘으면 413', async () => {
    const post = await newPost();
    const fits = Buffer.concat([PNG, Buffer.alloc(LIMIT - PNG.length, 1)]);
    const res = await upload(post.id, fits, 'image/png');
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json().size, LIMIT);

    const over = await upload(post.id, Buffer.concat([fits, Buffer.from([1])]), 'image/png');
    assert.equal(over.status, 413);
    assert.equal(over.json().code, 'too_large');
  });

  test('받지 않는 형식은 415: SVG는 머리글이 어떻든 거절한다', async () => {
    const post = await newPost();
    for (const [body, type] of [
      [SVG, 'image/svg+xml'],
      [SVG, 'image/png'],
      ['<html><script>alert(1)</script></html>', 'image/png'],
      ['그림이 아닌 글자', 'image/jpeg'],
      ['그림이 아닌 글자', 'text/plain'],
      [png(), 'application/octet-stream'],
    ] as const) {
      const res = await upload(post.id, body, type);
      assert.equal(res.status, 415, `${type}: ${res.text}`);
      assert.equal(res.json().code, 'unsupported_type');
    }
  });

  test('글 id 모양이 틀리면 400', async () => {
    assert.equal((await upload('not-a-uuid', png(), 'image/png')).status, 400);
  });
});

describe('사진 보기 (GET /api/files/:hash)', () => {
  test('공개 글의 사진: 누구나 받고, 오래 캐시하고, 저장한 형식으로 보낸다', async () => {
    const post = await newPost();
    const bytes = png();
    const { url } = await photoOf(post, bytes);
    await setStatus(post, 'published');

    const res = await fetch(`${api.baseUrl}${url}`);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('content-length'), String(bytes.length));
    assert.equal(res.headers.get('content-disposition'), 'inline');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });

  test('링크 공개 글의 사진도 방문자가 본다', async () => {
    const post = await newPost();
    const { url } = await photoOf(post);
    await setStatus(post, 'unlisted');
    assert.equal((await api.get(url)).status, 200);
  });

  test('임시 글의 사진: 방문자는 없는 파일과 똑같은 404, 주인은 캐시 없이 200', async () => {
    const post = await newPost();
    const { url } = await photoOf(post);
    const missing = await api.get(`/api/files/${'0'.repeat(64)}`);
    const visitor = await api.get(url);
    assert.equal(visitor.status, 404);
    assert.equal(visitor.text, missing.text);

    const mine = await api.get(url, owner);
    assert.equal(mine.status, 200);
    assert.equal(mine.header('cache-control'), 'no-store');
    assert.equal(mine.header('x-content-type-options'), 'nosniff');
    assert.equal(mine.header('content-disposition'), 'inline');
  });

  test('휴지통 글의 사진: 방문자는 404, 주인은 200', async () => {
    const post = await newPost();
    const { url } = await photoOf(post);
    const published = await setStatus(post, 'published');
    assert.equal((await api.get(url)).status, 200);

    const trashed = await api.request('DELETE', `/api/posts/${post.id}`, owner, {
      version: published.version,
    });
    assert.equal(trashed.status, 200, trashed.text);
    assert.equal((await api.get(url)).status, 404);
    const mine = await api.get(url, owner);
    assert.equal(mine.status, 200);
    assert.equal(mine.header('cache-control'), 'no-store');
  });

  test('공개를 거두면 방문자에게 다시 404', async () => {
    const post = await newPost();
    const { url } = await photoOf(post);
    const published = await setStatus(post, 'published');
    await setStatus(published, 'draft');
    assert.equal((await api.get(url)).status, 404);
  });

  test('같은 사진이 공개 글 하나에라도 있으면 공개다', async () => {
    const bytes = png();
    const hidden = await newPost();
    const { url } = await photoOf(hidden, bytes);
    assert.equal((await api.get(url)).status, 404);
    await photoOf(await newPost('published'), bytes);
    assert.equal((await api.get(url)).status, 200);
  });

  test('임시 글의 사진은 주인만: read_all 기기도 404', async () => {
    const post = await newPost();
    const { url } = await photoOf(post);
    const res = await api.request('GET', url, TestUser.visitor, undefined, {
      authorization: `Bearer ${device}`,
    });
    assert.equal(res.status, 404);
  });

  test('해시 모양이 아니면 주인에게도 404: 경로로 빠져나가지 못한다', async () => {
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', '.env', 'A'.repeat(64), 'a'.repeat(63)]) {
      assert.equal((await api.get(`/api/files/${bad}`, owner)).status, 404, bad);
      assert.equal((await api.get(`/api/files/${bad}`)).status, 404, bad);
    }
  });
});
