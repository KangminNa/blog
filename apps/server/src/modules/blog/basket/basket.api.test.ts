import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 소재: 주인이 콘솔에서 담고 지운다. 비공개 자료가 담기므로 REST는 주인만, MCP는 write 권한으로만 읽는다.

type Json = Record<string, unknown>;
type Item = { id: string; kind: string; refId: string | null; title: string | null };

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** write 권한을 준 기기 */
let writer: string;
/** 기본 권한만 있는 기기 */
let laptop: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const add = (body: Json, as: TestUser = owner) =>
  api.request('POST', '/api/basket/items', as, { requestId: randomUUID(), ...body });

const items = async () => ok(await api.get('/api/basket/items', owner)).items as Item[];

async function tool(token: string, name: string, args: Json = {}) {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') as Json }
    : { ok: true, body: result.structuredContent ?? {} };
}

async function newSession(token: string, title: string): Promise<string> {
  const { ok: saved, body } = await tool(token, 'save_session', {
    request_id: randomUUID(),
    source_session_id: `basket-${randomUUID()}`,
    tool: 'claude-code',
    project: 'cairn',
    title,
    did: '소재로 담을 세션',
  });
  assert.equal(saved, true, JSON.stringify(body));
  return String(body.session_id);
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  laptop = await api.connectDevice(owner, 'basket-laptop');
  writer = await api.connectDevice(owner, 'basket-writer');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'basket-writer');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'write'],
      version: device?.version,
    }),
  );
});

after(async () => {
  // 다음 테스트 파일이 받는 이벤트가 밀리지 않게 이 파일이 남긴 이벤트를 치운다
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
});

beforeEach(async () => {
  await db.sql`TRUNCATE work.baskets CASCADE`;
});

describe('누가 쓸 수 있나', () => {
  test('방문자는 소재를 보지도, 담지도, 지우지도 못한다', async () => {
    assert.equal((await api.get('/api/basket/items')).status, 403);
    const added = await add({ kind: 'note', note: '메모' }, TestUser.visitor);
    assert.equal(added.status, 403);
    const removed = await api.request('DELETE', `/api/basket/items/${randomUUID()}`);
    assert.equal(removed.status, 403);
  });

  test('기기는 write 권한이 있어도 REST로는 403', async () => {
    const headers = { authorization: `Bearer ${writer}` };
    const res = await api.request('GET', '/api/basket/items', TestUser.visitor, undefined, headers);
    assert.equal(res.status, 403);
    assert.equal(res.json().scope, 'owner');
  });

  test('basket_get: write 권한이 없으면 보이지 않고 부를 수도 없다', async () => {
    const list = (await api.mcp(laptop, 'tools/list')).json().result as {
      tools: { name: string }[];
    };
    assert.equal(
      list.tools.some((t) => t.name === 'basket_get'),
      false,
    );
    const { ok: done, body } = await tool(laptop, 'basket_get');
    assert.equal(done, false);
    assert.equal(body.code, 'forbidden');
  });

  test('basket_get: write 권한이면 소재를 snake_case로 읽는다', async () => {
    const id = await newSession(writer, '도구로 읽을 세션');
    ok(await add({ kind: 'session', refId: id }), 201);
    const { ok: done, body } = await tool(writer, 'basket_get');
    assert.equal(done, true, JSON.stringify(body));
    const [item] = body.items as Json[];
    assert.equal(item?.kind, 'session');
    assert.equal(item?.ref_id, id);
    assert.equal(item?.title, '도구로 읽을 세션');
    assert.equal(typeof item?.created_at, 'string');
  });
});

describe('담기 (POST /api/basket/items)', () => {
  test('상자가 없으면 빈 목록이고, 읽기만으로는 상자가 생기지 않는다', async () => {
    assert.deepEqual(await items(), []);
    assert.equal((await db.sql`SELECT 1 FROM work.baskets`).length, 0);
  });

  test('링크와 메모를 담으면 새로 담은 것부터 보인다', async () => {
    const link = ok(
      await add({ kind: 'link', url: 'https://example.com/a', title: '참고 글' }),
      201,
    );
    assert.equal(link.url, 'https://example.com/a');
    assert.equal(link.title, '참고 글');
    const memo = ok(await add({ kind: 'note', note: '이런 얘기를 쓰자' }), 201);
    assert.equal(memo.note, '이런 얘기를 쓰자');
    assert.deepEqual(
      (await items()).map((i) => i.kind),
      ['note', 'link'],
    );
  });

  test('처음 담는 요청이 동시에 와도 상자는 하나', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => add({ kind: 'note', note: `메모 ${i}` })),
    );
    for (const res of results) assert.equal(res.status, 201, res.text);
    assert.equal((await db.sql`SELECT 1 FROM work.baskets`).length, 1);
    assert.equal((await items()).length, 8);
  });

  test('같은 requestId는 하나만 담고 처음 소재를 돌려준다', async () => {
    const requestId = randomUUID();
    const first = ok(await add({ requestId, kind: 'note', note: '두 번 누름' }), 201);
    const again = ok(await add({ requestId, kind: 'note', note: '두 번 누름' }), 201);
    assert.equal(again.id, first.id);
    assert.equal((await items()).length, 1);
  });

  test('세션: 있어야 담고, 제목을 비우면 세션 제목으로', async () => {
    const id = await newSession(laptop, '담을 세션');
    const item = ok(await add({ kind: 'session', refId: id }), 201);
    assert.equal(item.refId, id);
    assert.equal(item.title, '담을 세션');
    assert.equal((await add({ kind: 'session', refId: randomUUID() })).status, 404);
  });

  test('글: 있어야 담고, 제목을 정하면 그 제목으로. 휴지통 글은 404', async () => {
    const post = ok(
      await api.request('POST', '/api/posts', owner, { requestId: randomUUID(), title: '담을 글' }),
      201,
    );
    const item = ok(await add({ kind: 'post', refId: post.id }), 201);
    assert.equal(item.title, '담을 글');
    const named = ok(await add({ kind: 'post', refId: post.id, title: '다른 이름' }), 201);
    assert.equal(named.title, '다른 이름');
    assert.equal((await add({ kind: 'post', refId: randomUUID() })).status, 404);

    ok(await api.request('DELETE', `/api/posts/${post.id}`, owner, { version: post.version }));
    assert.equal((await add({ kind: 'post', refId: post.id })).status, 404);
  });

  test('사진·파일은 아직 받지 않는다 (400)', async () => {
    for (const kind of ['photo', 'file']) {
      const res = await add({ kind, title: '사진' });
      assert.equal(res.status, 400, res.text);
      assert.ok((res.json().fields as Json).kind);
    }
  });

  test('링크는 http·https만 (400)', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'x']) {
      const res = await add({ kind: 'link', url });
      assert.equal(res.status, 400, url);
      assert.ok((res.json().fields as Json).url);
    }
    assert.equal((await items()).length, 0);
  });
});

describe('지우기 (DELETE /api/basket/items/:id)', () => {
  test('소재만 지운다. 다시 지우면 404', async () => {
    const post = ok(
      await api.request('POST', '/api/posts', owner, { requestId: randomUUID(), title: '남을 글' }),
      201,
    );
    const item = ok(await add({ kind: 'post', refId: post.id }), 201);
    const path = `/api/basket/items/${item.id}`;
    assert.equal((await api.request('DELETE', path, owner)).status, 204);
    assert.deepEqual(await items(), []);
    assert.equal((await api.request('DELETE', path, owner)).status, 404);
    assert.equal((await api.get(`/api/posts/${post.id}`, owner)).status, 200);
  });

  test('id 모양이 틀리면 400', async () => {
    assert.equal((await api.request('DELETE', '/api/basket/items/x', owner)).status, 400);
  });
});

describe('페이지 보관 (MCP keep_page, 브라우저 확장)', () => {
  const keep = (token: string, args: Json) =>
    tool(token, 'keep_page', { request_id: randomUUID(), title: '읽은 글', ...args });

  test('upload 기기가 지금 페이지를 링크 소재로 담고, 읽은 글은 비밀값을 지워 메모로 둔다', async () => {
    const url = `https://example.com/read/${randomUUID()}`;
    const kept = await keep(laptop, {
      url,
      text: `본문 첫 줄\n키 sk-ant-api03-${'k'.repeat(40)}`,
    });
    assert.equal(kept.ok, true, JSON.stringify(kept.body));
    assert.equal(kept.body.status, 'saved');
    const [item] = (await items()) as (Item & { url: string; note: string })[];
    assert.deepEqual([item?.id, item?.kind, item?.url], [kept.body.item_id, 'link', url]);
    assert.match(item?.note ?? '', /본문 첫 줄/);
    assert.ok(!(item?.note ?? '').includes('sk-ant-api03'), '비밀값은 지운다');
    const [row] = await db.sql<{ actor_type: string }[]>`
      SELECT actor_type FROM work.basket_items WHERE id = ${String(kept.body.item_id)}`;
    assert.equal(row?.actor_type, 'device');
  });

  test('같은 주소는 한 번만 (duplicate), 같은 request_id도 한 번만', async () => {
    const url = `https://example.com/twice/${randomUUID()}`;
    const first = await keep(laptop, { url });
    const again = await keep(laptop, { url, title: '다른 제목' });
    assert.deepEqual([again.body.status, again.body.item_id], ['duplicate', first.body.item_id]);
    const requestId = randomUUID();
    const one = await tool(laptop, 'keep_page', {
      request_id: requestId,
      url: `${url}?b`,
      title: 'b',
    });
    const two = await tool(laptop, 'keep_page', {
      request_id: requestId,
      url: `${url}?b`,
      title: 'b',
    });
    assert.equal(one.body.item_id, two.body.item_id);
    assert.equal((await items()).length, 2);
  });

  test('주소는 http · https만, 방문자는 부르지 못한다', async () => {
    const bad = await keep(laptop, { url: 'javascript:alert(1)' });
    assert.equal(bad.ok, false);
    const visitor = await api.mcp(null, 'tools/call', {
      name: 'keep_page',
      arguments: { request_id: randomUUID(), url: 'https://example.com', title: 'x' },
    });
    assert.equal(visitor.status, 401);
    assert.equal((await items()).length, 0);
  });
});
