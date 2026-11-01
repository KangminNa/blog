import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 글에 이은 wiki가 휴지통으로 가면 없는 wiki와 같다: 새로 잇지 못하고, 이어 둔 글은 그대로 쓰고 고칠 수 있다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const trashed = async (wikiId: unknown) =>
  db.sql`UPDATE vault.nodes SET deleted_at = now() WHERE id = ${String(wikiId)}`;

const newWiki = async (): Promise<Json> =>
  ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: `wiki ${randomUUID().slice(0, 8)}`,
      bodyMd: '## 본문\n내용',
    }),
    201,
  );

const newPost = async (more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title: `글 ${randomUUID().slice(0, 8)}`,
      body: '본문',
      ...more,
    }),
    201,
  );

const saveAs = (post: Json, more: Json = {}) =>
  api.request('PUT', `/api/posts/${post.id}`, owner, {
    version: post.version,
    title: post.title,
    body: post.body,
    tags: post.tags,
    align: post.align,
    ...more,
  });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
});

after(async () => {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
});

test('휴지통 wiki는 새로 잇지 못한다 (404)', async () => {
  const wiki = await newWiki();
  await trashed(wiki.id);
  const post = await newPost();
  assert.equal((await saveAs(post, { mainWikiId: wiki.id })).status, 404);
  assert.equal((await saveAs(post, { refWikiIds: [wiki.id] })).status, 404);
});

test('이어 둔 wiki가 사라져도 연결을 보내지 않으면 글을 고칠 수 있고, 비워서 정리할 수 있다', async () => {
  const [main, ref] = [await newWiki(), await newWiki()];
  const post = await newPost({ mainWikiId: main.id, refWikiIds: [ref.id] });
  await trashed(main.id);
  await trashed(ref.id);

  const edited = ok(await saveAs(post, { title: '고친 제목' }));
  assert.equal(edited.mainWikiId, main.id);
  assert.deepEqual(edited.refWikiIds, [ref.id]);

  // 편집기는 이 wiki를 읽어 찾을 수 없음을 알고 지우게 한다
  assert.equal((await api.get(`/api/wikis/${main.id}`, owner)).status, 404);
  const cleared = ok(await saveAs(edited, { mainWikiId: null, refWikiIds: [] }));
  assert.equal(cleared.mainWikiId, null);
  assert.deepEqual(cleared.refWikiIds, []);
});
