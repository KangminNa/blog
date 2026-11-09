import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, DomainEvent, Outbox, OutboxWorker } from '../../platform';

// 그래프. 보이는 범위는 서버가 거른다: 방문자에게 비공개 wiki·세션의 이름·id·날짜가 닿지 않는다 (기획서 9장, 원칙 4·5).
// 글 점은 blog 이벤트로 채운 사본(post_marks)으로 그린다.

type Json = Record<string, unknown>;
type Graph = { nodes: Json[]; edges: Json[] };

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let spaceId: string;
/** 기본 권한 (upload · read_public) */
let laptop: string;
/** read_all · tidy */
let tidier: string;

/** 앞 테스트의 것과 섞이지 않는 이름 */
const named = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function call(
  token: string,
  name: string,
  args: Json,
): Promise<{ ok: boolean; body: Json; text: string }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}'), text: res.text }
    : { ok: true, body: result.structuredContent ?? {}, text: res.text };
}

const ownerGraph = async (): Promise<Graph> =>
  ok(await api.get('/api/graph', owner)) as unknown as Graph;

const publicGraph = async (as?: TestUser): Promise<Graph> =>
  ok(await api.get('/api/graph/public', as)) as unknown as Graph;

const newCategory = async (name = named('구역')): Promise<Json> =>
  ok(await api.request('POST', '/api/categories', owner, { requestId: randomUUID(), name }), 201);

async function newWiki(open: boolean, more: Json = {}): Promise<Json> {
  const wiki = ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: named(open ? '공개 wiki' : '비공개 wiki'),
      bodyMd: '## 본문\n내용',
      ...more,
    }),
    201,
  );
  if (!open) return wiki;
  return ok(
    await api.request('PUT', `/api/wikis/${wiki.id}`, owner, {
      version: wiki.version,
      title: wiki.title,
      bodyMd: wiki.bodyMd,
      visibility: 'public',
    }),
  );
}

async function newSession(open: boolean, wikiId: unknown = null, title = named('세션')) {
  const saved = await call(laptop, 'save_session', {
    request_id: randomUUID(),
    source_session_id: randomUUID(),
    tool: 'claude-code',
    project: 'cairn',
    title,
    did: '한 일',
  });
  assert.equal(saved.ok, true, saved.text);
  const id = String(saved.body.session_id);
  await db.sql`
    UPDATE vault.sessions
    SET visibility = ${open ? 'public' : 'private'}, wiki_id = ${wikiId as string | null}
    WHERE node_id = ${id}`;
  return { id, title };
}

/** 선은 변경 묶음으로만 생긴다 */
async function addEdge(src: unknown, dst: unknown, kind: string): Promise<void> {
  const set = await call(tidier, 'submit_changes', {
    request_id: randomUUID(),
    message: '선 잇기',
    ops: [{ op: 'edge.add', payload: { src, dst, kind } }],
  });
  assert.equal(set.ok, true, set.text);
  assert.equal((set.body.ops as Json[])[0]?.status, 'applied', set.text);
}

/** blog가 보낸 것처럼 글 이벤트를 outbox와 일꾼으로 흘린다 */
async function postEvent(topic: string, data: Json): Promise<void> {
  const event = new DomainEvent(topic, 1, spaceId, data);
  await db.transaction((tx) => new Outbox(tx).publish([event]));
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

async function publishPost(main: unknown, more: Json = {}): Promise<Json> {
  const post = {
    postId: randomUUID(),
    slug: named('글').replace(' ', '-'),
    title: named('글'),
    status: 'published',
    postVersion: 1,
    mainWikiId: main,
    refWikiIds: [],
    ...more,
  };
  await postEvent('blog.post.published', post);
  return post;
}

const nodeOf = (graph: Graph, id: unknown) => graph.nodes.find((n) => n.id === id);

const hasEdge = (graph: Graph, src: unknown, dst: unknown, kind: string) =>
  graph.edges.some((e) => e.src === src && e.dst === dst && e.kind === kind);

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  laptop = await api.connectDevice(owner, 'graph-laptop');
  tidier = await api.connectDevice(owner, 'graph-tidier');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; version: number }[];
  };
  const device = devices.find((d) => d.name === 'graph-tidier');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: ['read_all', 'tidy'],
      version: device?.version,
    }),
  );
  const { id } = await newWiki(false);
  const [wiki] = await db.sql`SELECT space_id FROM vault.wikis WHERE node_id = ${String(id)}`;
  spaceId = String(wiki?.space_id);
});

after(() => api.close());

describe('주인의 그래프', () => {
  test('방문자와 기기는 볼 수 없다', async () => {
    assert.equal((await api.get('/api/graph')).status, 403);
    const res = await fetch(`${api.baseUrl}/api/graph`, {
      headers: { authorization: `Bearer ${tidier}` },
    });
    assert.equal(res.status, 403);
  });

  test('점 네 종류와 주소, 선 세 종류가 보인다', async () => {
    const category = await newCategory();
    const main = await newWiki(false, { categoryId: category.id });
    const other = await newWiki(true);
    const session = await newSession(false, main.id);
    const lost = await newSession(false);
    await addEdge(session.id, other.id, 'material');
    await addEdge(main.id, other.id, 'link');
    const post = await publishPost(main.id, { refWikiIds: [other.id, main.id] });

    const graph = await ownerGraph();
    assert.deepEqual(nodeOf(graph, category.id), {
      id: category.id,
      kind: 'category',
      label: category.name,
      parent: null,
    });
    assert.deepEqual(nodeOf(graph, main.id), {
      id: main.id,
      kind: 'wiki',
      label: main.title,
      parent: category.id,
      visibility: 'private',
    });
    assert.deepEqual(nodeOf(graph, session.id), {
      id: session.id,
      kind: 'session',
      label: session.title,
      parent: main.id,
      visibility: 'private',
    });
    assert.equal(nodeOf(graph, lost.id)?.parent, null, '정리 전 세션은 도착 구역');
    assert.equal(nodeOf(graph, other.id)?.parent, null, '카테고리가 없는 wiki는 미분류');
    assert.deepEqual(nodeOf(graph, post.postId), {
      id: post.postId,
      kind: 'post',
      label: post.title,
      parent: main.id,
      visibility: 'public',
      slug: post.slug,
    });
    assert.equal(hasEdge(graph, session.id, other.id, 'material'), true);
    assert.equal(
      hasEdge(graph, main.id, other.id, 'link') || hasEdge(graph, other.id, main.id, 'link'),
      true,
    );
    assert.equal(hasEdge(graph, post.postId, other.id, 'ref'), true);
    assert.equal(hasEdge(graph, post.postId, main.id, 'ref'), false, '대표는 선이 아니다');
  });

  test('wiki가 없는 글과 임시 글: 없는 글은 빠지고 임시 글은 주인에게만', async () => {
    const wiki = await newWiki(true);
    const none = await publishPost(null);
    const draft = await publishPost(wiki.id, { status: 'draft' });
    const graph = await ownerGraph();
    assert.equal(nodeOf(graph, none.postId), undefined);
    assert.equal(nodeOf(graph, draft.postId)?.visibility, 'private');
    assert.equal(nodeOf(await publicGraph(), draft.postId), undefined);
  });

  test('휴지통의 점은 빠지고 그쪽을 가리키던 주소는 빈다', async () => {
    const wiki = await newWiki(false);
    const session = await newSession(false, wiki.id);
    const post = await publishPost(wiki.id);
    await db.sql`UPDATE vault.nodes SET deleted_at = now() WHERE id = ${String(wiki.id)}`;
    const graph = await ownerGraph();
    assert.equal(nodeOf(graph, wiki.id), undefined);
    assert.equal(nodeOf(graph, session.id)?.parent, null);
    assert.equal(nodeOf(graph, post.postId), undefined);
  });
});

describe('방문자의 그래프', () => {
  test('공개한 것과 카테고리 이름만 온다. 비공개는 이름도 id도 없다', async () => {
    const category = await newCategory();
    const open = await newWiki(true, { categoryId: category.id });
    const secret = await newWiki(false, { categoryId: category.id });
    const openSession = await newSession(true, open.id);
    const secretSession = await newSession(false, open.id, named('비밀 세션'));
    await newSession(false, secret.id);
    const post = await publishPost(open.id);

    const res = await api.get('/api/graph/public');
    const graph = res.json() as unknown as Graph;
    assert.equal(res.status, 200);
    assert.equal(res.header('cache-control'), 'no-store');
    assert.equal(nodeOf(graph, category.id)?.label, category.name);
    assert.equal(nodeOf(graph, open.id)?.parent, category.id);
    assert.equal(nodeOf(graph, openSession.id)?.parent, open.id);
    assert.equal(nodeOf(graph, post.postId)?.slug, post.slug);
    for (const hidden of [secret.id, secret.title, secretSession.id, secretSession.title])
      assert.equal(res.text.includes(String(hidden)), false, String(hidden));
  });

  test('공개 글이 가리키는 비공개 wiki는 자리만 남는다: 이름·날짜·주소·내용이 없다', async () => {
    const category = await newCategory();
    const secret = await newWiki(false, { categoryId: category.id, bodyMd: '## 비밀\n숨긴 내용' });
    const secretRef = await newWiki(false);
    const post = await publishPost(secret.id, { refWikiIds: [secretRef.id] });

    const res = await api.get('/api/graph/public');
    const graph = res.json() as unknown as Graph;
    const mark = nodeOf(graph, post.postId);
    assert.equal(mark?.kind, 'post');
    const place = nodeOf(graph, mark?.parent);
    assert.deepEqual(Object.keys(place ?? {}).sort(), [
      'id',
      'kind',
      'label',
      'parent',
      'visibility',
    ]);
    assert.equal(place?.kind, 'wiki');
    assert.equal(place?.label, '');
    assert.equal(place?.parent, null, '자리는 카테고리도 알리지 않는다');
    assert.equal(place?.visibility, 'private');
    assert.match(String(place?.id), /^private-[0-9a-f]{16}$/, 'UUIDv7이면 날짜가 드러난다');

    const ref = graph.edges.find((e) => e.src === post.postId && e.kind === 'ref');
    const refPlace = nodeOf(graph, ref?.dst);
    assert.equal(refPlace?.label, '');
    assert.equal(refPlace?.visibility, 'private');
    assert.notEqual(refPlace?.id, place?.id);

    for (const hidden of [
      secret.id,
      secret.title,
      secret.slug,
      '숨긴 내용',
      secretRef.id,
      secretRef.title,
    ])
      assert.equal(res.text.includes(String(hidden)), false, String(hidden));
  });

  test('글이 가리키지 않는 비공개 wiki로 가는 연결은 흔적이 없다', async () => {
    const secret = await newWiki(false);
    const open = await newWiki(true);
    const session = await newSession(true, secret.id);
    await addEdge(open.id, secret.id, 'link');
    await addEdge(session.id, open.id, 'material');

    const res = await api.get('/api/graph/public');
    const graph = res.json() as unknown as Graph;
    assert.equal(res.text.includes(String(secret.id)), false);
    assert.equal(nodeOf(graph, session.id)?.parent, null, '주소로 비공개 id가 새지 않는다');
    assert.equal(hasEdge(graph, session.id, open.id, 'material'), true, '공개끼리의 선은 보인다');
    assert.equal(
      graph.edges.some((e) => e.kind === 'link' && (e.src === open.id || e.dst === open.id)),
      false,
      '비공개 wiki로 가는 링크는 없다',
    );
  });

  test('임시 글과 링크만 공개 글은 나오지 않는다', async () => {
    const open = await newWiki(true);
    const draft = await publishPost(open.id, { status: 'draft' });
    const unlisted = await publishPost(open.id, { status: 'unlisted' });
    const res = await api.get('/api/graph/public');
    for (const post of [draft, unlisted]) {
      assert.equal(res.text.includes(String(post.postId)), false);
      assert.equal(res.text.includes(String(post.title)), false);
    }
  });

  test('휴지통의 비공개 wiki는 자리도 남지 않고 글도 빠진다', async () => {
    const secret = await newWiki(false);
    const post = await publishPost(secret.id);
    await db.sql`UPDATE vault.nodes SET deleted_at = now() WHERE id = ${String(secret.id)}`;
    assert.equal(nodeOf(await publicGraph(), post.postId), undefined);
  });

  test('주인이 불러도 방문자가 보는 그대로다', async () => {
    const secret = await newWiki(false);
    const res = await api.get('/api/graph/public', owner);
    assert.equal(res.status, 200);
    assert.equal(res.text.includes(String(secret.title)), false);
    assert.deepEqual(res.json(), await publicGraph());
  });
});

describe('글 자리 사본', () => {
  const mark = async (postId: unknown) => {
    const [row] = await db.sql`SELECT * FROM vault.post_marks WHERE post_id = ${String(postId)}`;
    return row;
  };

  test('postVersion이 더 큰 이벤트만 반영한다 (순서가 바뀌어도)', async () => {
    const first = await newWiki(true);
    const second = await newWiki(true);
    const post = await publishPost(first.id, { postVersion: 3, title: '셋째' });
    await postEvent('blog.post.updated', { ...post, postVersion: 2, title: '늦게 온 둘째' });
    assert.equal((await mark(post.postId))?.title, '셋째');
    await postEvent('blog.post.published', post);
    assert.equal((await mark(post.postId))?.post_version, 3, '같은 이벤트가 또 와도 같다');

    await postEvent('blog.post.updated', {
      ...post,
      postVersion: 4,
      title: '넷째',
      mainWikiId: second.id,
    });
    const row = await mark(post.postId);
    assert.equal(row?.title, '넷째');
    assert.equal(row?.main_wiki_id, second.id);
  });

  test('내리면 방문자에게서 사라지고 다시 공개하면 돌아온다', async () => {
    const wiki = await newWiki(true);
    const post = await publishPost(wiki.id);
    await postEvent('blog.post.unpublished', { ...post, status: 'unlisted', postVersion: 2 });
    assert.equal((await mark(post.postId))?.status, 'draft');
    assert.equal(nodeOf(await publicGraph(), post.postId), undefined);
    await postEvent('blog.post.published', { ...post, postVersion: 3 });
    assert.notEqual(nodeOf(await publicGraph(), post.postId), undefined);
  });

  test('휴지통으로 간 글은 주인의 그래프에서도 빠진다', async () => {
    const wiki = await newWiki(true);
    const post = await publishPost(wiki.id);
    await postEvent('blog.post.deleted', { ...post, postVersion: 2 });
    assert.equal(nodeOf(await ownerGraph(), post.postId), undefined);
    assert.equal(nodeOf(await publicGraph(), post.postId), undefined);
  });

  test('글 버전이 없는 이벤트는 건너뛰고, 없는 wiki를 가리켜도 일꾼이 멈추지 않는다', async () => {
    const postId = randomUUID();
    await postEvent('blog.post.publish_failed', { postId, approvalId: randomUUID() });
    assert.equal(await mark(postId), undefined);
    assert.equal(await api.unprocessed('blog.post.publish_failed'), 0);

    const post = await publishPost(randomUUID());
    assert.equal((await mark(post.postId))?.main_wiki_id, null);
    assert.equal(await api.unprocessed('blog.post.published'), 0);
  });
});

describe('neighbors', () => {
  const neighbors = (token: string, id: unknown) => call(token, 'neighbors', { node_id: id });

  test('read_public은 공개 점과 공개 이웃만 본다', async () => {
    const category = await newCategory();
    const wiki = await newWiki(true, { categoryId: category.id });
    const open = await newSession(true, wiki.id);
    const secret = await newSession(false, wiki.id, named('비밀 세션'));
    const hidden = await newWiki(false);
    await addEdge(wiki.id, hidden.id, 'link');
    const post = await publishPost(wiki.id, { refWikiIds: [hidden.id] });

    const { body, text } = await neighbors(laptop, wiki.id);
    assert.equal((body.node as Json).id, wiki.id);
    const near = body.neighbors as Json[];
    assert.deepEqual(
      near.map((n) => [n.id, n.relation]).sort(),
      [
        [category.id, 'parent'],
        [open.id, 'child'],
        [post.postId, 'child'],
      ].sort(),
    );
    assert.deepEqual(Object.keys(near[0] ?? {}), ['id', 'kind', 'label', 'relation']);
    assert.equal(text.includes(secret.id), false);
    assert.equal(text.includes(secret.title), false);
    assert.equal(text.includes(String(hidden.id)), false);
  });

  test('볼 수 없는 점은 없는 점과 똑같이 답한다', async () => {
    const secret = await newWiki(false);
    const session = await newSession(false);
    const missing = await neighbors(laptop, randomUUID());
    for (const id of [secret.id, session.id]) {
      const res = await neighbors(laptop, id);
      assert.equal(res.ok, false);
      assert.deepEqual(res.body, missing.body);
    }
  });

  test('read_all은 비공개 점과 이웃까지 본다', async () => {
    const secret = await newWiki(false);
    const other = await newWiki(false);
    const session = await newSession(false, secret.id);
    await addEdge(session.id, other.id, 'material');
    await addEdge(secret.id, other.id, 'link');
    const post = await publishPost(secret.id, { refWikiIds: [other.id] });

    const { body } = await neighbors(tidier, other.id);
    const relations = (body.neighbors as Json[]).map((n) => [n.id, n.relation]);
    assert.deepEqual(
      relations.sort(),
      [
        [session.id, 'material'],
        [secret.id, 'link'],
        [post.postId, 'ref'],
      ].sort(),
    );
    assert.equal(((await neighbors(tidier, session.id)).body.node as Json).label, session.title);
  });

  test('공개 글의 비공개 자리는 이웃으로 알리지 않고, 자리의 id로는 찾을 수 없다', async () => {
    const secret = await newWiki(false);
    const post = await publishPost(secret.id);
    const { body } = await neighbors(laptop, post.postId);
    assert.deepEqual(body.neighbors, []);

    const graph = await publicGraph();
    const place = nodeOf(graph, post.postId)?.parent;
    const res = await neighbors(laptop, place);
    assert.equal(res.ok, false);
  });

  test('읽기 권한이 없는 기기에게는 보이지 않는다', async () => {
    const name = `graph-upload-${randomUUID()}`;
    const token = await api.connectDevice(owner, name);
    const { devices } = ok(await api.get('/api/devices', owner)) as {
      devices: { id: string; name: string; version: number }[];
    };
    const device = devices.find((d) => d.name === name);
    ok(
      await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
        scopes: ['upload'],
        version: device?.version,
      }),
    );
    const list = (await api.mcp(token, 'tools/list')).json().result as {
      tools: { name: string }[];
    };
    assert.equal(
      list.tools.some((t) => t.name === 'neighbors'),
      false,
    );
  });
});
