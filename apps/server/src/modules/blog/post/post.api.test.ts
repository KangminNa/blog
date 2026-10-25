import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 블로그 글: 주인이 편집기에서 쓰고·고치고·공개 범위를 정하고·휴지통에 넣는다. 방문자는 공개 글만 목록에서 본다.

let api: ApiClient;
let owner: TestUser;

type Saved = { id: string; slug: string; version: number; status: string; revised: boolean };

async function create(title: string, more: Record<string, unknown> = {}): Promise<Saved> {
  const res = await api.request('POST', '/api/posts', owner, {
    requestId: randomUUID(),
    title,
    body: `${title} 본문`,
    ...more,
  });
  assert.equal(res.status, 201, res.text);
  return res.json() as Saved;
}

async function setStatus(post: Saved, status: string): Promise<Saved> {
  const res = await api.request('POST', `/api/posts/${post.id}/status`, owner, {
    version: post.version,
    status,
  });
  assert.equal(res.status, 200, res.text);
  return res.json() as Saved;
}

const slugsOf = (res: { json(): Record<string, unknown> }) =>
  (res.json().posts as { slug: string }[]).map((p) => p.slug);

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  await api.service(Database).sql`TRUNCATE blog.posts CASCADE`;
});
after(() => api.close());

describe('글 쓰기와 고치기', () => {
  test('새 글은 임시 상태 1판. 주소는 제목에서 (한글 그대로), 겹치면 -2', async () => {
    const first = await create('세션 저장 API 만들기');
    assert.equal(first.slug, '세션-저장-api-만들기');
    assert.equal(first.status, 'draft');
    assert.equal(first.version, 1);
    const again = await create('세션 저장 API 만들기');
    assert.equal(again.slug, '세션-저장-api-만들기-2');
  });

  test('같은 requestId를 다시 보내면 글은 하나 (처음 만든 글을 돌려준다)', async () => {
    const requestId = randomUUID();
    const body = { requestId, title: '두 번 누름' };
    const a = (await api.request('POST', '/api/posts', owner, body)).json() as Saved;
    const b = (await api.request('POST', '/api/posts', owner, body)).json() as Saved;
    assert.equal(a.id, b.id);
  });

  test('고쳐 쓰기: 바뀌면 새 판, 같으면 판 없이. 낡은 버전으로 보내면 409', async () => {
    const post = await create('고칠 글');
    const save = (version: number, body: string) =>
      api.request('PUT', `/api/posts/${post.id}`, owner, { version, title: '고칠 글', body });
    const changed = (await save(1, '새 본문')).json() as Saved & { revisionCount: number };
    assert.equal(changed.revised, true);
    assert.equal(changed.revisionCount, 2);
    assert.equal(changed.version, 2);
    const same = (await save(2, '새 본문')).json() as Saved & { revisionCount: number };
    assert.equal(same.revised, false);
    assert.equal(same.version, 2);
    const stale = await save(1, '옛 화면에서');
    assert.equal(stale.status, 409);
  });

  test('주소를 직접 정할 수 있고, 다른 글이 쓰는 주소면 422', async () => {
    const post = await create('주소 바꿀 글');
    const res = await api.request('PUT', `/api/posts/${post.id}`, owner, {
      version: 1,
      title: '주소 바꿀 글',
      slug: '세션-저장-api-만들기',
    });
    assert.equal(res.status, 422);
    assert.match(String(res.json().message), /이미 쓰는 주소/);
    const ok = await api.request('PUT', `/api/posts/${post.id}`, owner, {
      version: 1,
      title: '주소 바꿀 글',
      slug: 'my-post',
    });
    assert.equal((ok.json() as Saved).slug, 'my-post');
  });

  test('모양이 틀리면 400, 방문자가 쓰려 하면 403', async () => {
    const bad = await api.request('POST', '/api/posts', owner, { requestId: 'x', title: '' });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.json().fields as object).sort(), ['requestId', 'title']);
    const visitor = await api.request('POST', '/api/posts', TestUser.visitor, {
      requestId: randomUUID(),
      title: '몰래',
    });
    assert.equal(visitor.status, 403);
  });
});

describe('공개 범위', () => {
  let published: Saved;
  let unlisted: Saved;
  let draft: Saved;

  before(async () => {
    published = await setStatus(await create('공개 글'), 'published');
    unlisted = await setStatus(await create('링크만 글'), 'unlisted');
    draft = await create('임시 글');
  });

  test('방문자 목록에는 공개 글만', async () => {
    const res = await api.get('/api/posts');
    assert.deepEqual(slugsOf(res), ['공개-글']);
    assert.equal(res.json().counts, undefined);
    const first = (res.json().posts as Record<string, unknown>[])[0] ?? {};
    assert.deepEqual(Object.keys(first).sort(), [
      'excerpt',
      'publishedAt',
      'slug',
      'tags',
      'title',
    ]);
  });

  test('주소로 열기: 방문자는 공개·링크만 글, 임시 글은 404. 주인은 임시 글도 미리 본다', async () => {
    const open = (slug: string, as = TestUser.visitor) =>
      api.get(`/api/posts/by-slug/${encodeURIComponent(slug)}`, as);
    assert.equal((await open(published.slug)).status, 200);
    const link = await open(unlisted.slug);
    assert.equal(link.status, 200);
    assert.equal(link.json().body, '링크만 글 본문');
    assert.equal(link.json().version, undefined);
    assert.equal(link.json().listed, false);
    assert.equal((await open(draft.slug)).status, 404);
    const preview = await open(draft.slug, owner);
    assert.equal(preview.json().status, 'draft');
  });

  test('주인 목록: 탭별 글 수와 상태별 거르기', async () => {
    const res = await api.get('/api/posts?status=unlisted', owner);
    assert.deepEqual(slugsOf(res), ['링크만-글']);
    const counts = res.json().counts as Record<string, number>;
    assert.equal(counts.published, 1);
    assert.equal(counts.unlisted, 1);
    assert.ok((counts.draft ?? 0) >= 1);
  });
});

describe('휴지통', () => {
  test('휴지통 글은 방문자에게 없는 글. 주인은 휴지통 탭에서 보고 되살린다', async () => {
    const post = await setStatus(await create('지울 글'), 'published');
    const trashed = await api.request('DELETE', `/api/posts/${post.id}`, owner, {
      version: post.version,
    });
    assert.equal(trashed.status, 200, trashed.text);
    const after = trashed.json() as Saved;
    assert.equal(
      (await api.get(`/api/posts/by-slug/${encodeURIComponent(post.slug)}`)).status,
      404,
    );
    assert.ok(slugsOf(await api.get('/api/posts?status=trash', owner)).includes(post.slug));
    const edit = await api.request('PUT', `/api/posts/${post.id}`, owner, {
      version: after.version,
      title: '지울 글',
    });
    assert.equal(edit.status, 422);
    const back = await api.request('POST', `/api/posts/${post.id}/restore`, owner, {
      version: after.version,
    });
    assert.equal(back.status, 200, back.text);
    assert.equal((back.json() as Saved).status, 'published');
    assert.ok(slugsOf(await api.get('/api/posts')).includes(post.slug));
  });
});
