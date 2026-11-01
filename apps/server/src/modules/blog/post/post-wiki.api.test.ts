import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { BaseHandler, CoreWorkers, Database, type DomainEvent, OutboxWorker } from '../../platform';

// 글 → wiki 연결: 편집기(REST)와 AI 도구(MCP)로 잇고, 이벤트가 outbox와 일꾼을 실제로 거쳐 그래프에 나온다.
// 비공개 wiki의 id는 볼 수 없는 요청자에게 닿지 않는다 (원칙 4·5).

type Json = Record<string, unknown>;
type Graph = { nodes: Json[]; edges: Json[] };

/** 일꾼이 받는 쪽에 넘긴 글 이벤트 */
class Seen extends BaseHandler {
  readonly events: DomainEvent[] = [];

  async handle(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
}

const seen = new Seen();
let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
/** 기본 권한 + write 기기: 공개 wiki까지만 본다 */
let writer: string;
/** write · read_all 기기 */
let reader: string;
/** run 권한을 준 기기 (러너) */
let runner: string;
/** 이 파일이 만든 에이전트 (끝나면 멈춘다) */
const agents: Json[] = [];

const named = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

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

async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const { ok: done, body } = await tool(token, name, args);
  assert.equal(done, true, JSON.stringify(body));
  return body;
}

async function grant(name: string, scopes: readonly string[]): Promise<void> {
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === name);
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), ...scopes],
      version: device?.version,
    }),
  );
}

async function newWiki(open: boolean): Promise<Json> {
  const wiki = ok(
    await api.request('POST', '/api/wikis', owner, {
      requestId: randomUUID(),
      title: named(open ? '공개 wiki' : '비공개 wiki'),
      bodyMd: '## 본문\n내용',
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

async function create(more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/posts', owner, {
      requestId: randomUUID(),
      title: named('글'),
      body: '본문',
      ...more,
    }),
    201,
  );
}

/** 지금 글을 그대로 두고 받은 칸만 바꿔 저장한다 */
const saveAs = (post: Json, more: Json = {}) =>
  api.request('PUT', `/api/posts/${post.id}`, owner, {
    version: post.version,
    title: post.title,
    body: post.body,
    tags: post.tags,
    align: post.align,
    ...more,
  });

const save = async (post: Json, more: Json = {}): Promise<Json> => ok(await saveAs(post, more));

const read = async (id: unknown): Promise<Json> => ok(await api.get(`/api/posts/${id}`, owner));

const setStatus = async (post: Json, status: string): Promise<Json> =>
  ok(
    await api.request('POST', `/api/posts/${post.id}/status`, owner, {
      version: post.version,
      status,
    }),
  );

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

const ownerGraph = async (): Promise<Graph> =>
  ok(await api.get('/api/graph', owner)) as unknown as Graph;

const publicGraph = async (): Promise<Graph> =>
  ok(await api.get('/api/graph/public')) as unknown as Graph;

const nodeOf = (graph: Graph, id: unknown) => graph.nodes.find((n) => n.id === id);

const refsOf = (graph: Graph, id: unknown) =>
  graph.edges.filter((e) => e.src === id && e.kind === 'ref').map((e) => e.dst);

/** 에이전트에게 일을 맡겨 러너가 빌린다 */
async function lease(scopes: readonly string[]) {
  const agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      tool: 'claude',
      scopes,
      approvalActions: ['blog.post.publish'],
    }),
    201,
  );
  agents.push(agent);
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      kind: 'draft_post',
      title: '소재로 초안 쓰기',
      instruction: '소재로 블로그 초안을 써 주세요',
    }),
    201,
  );
  for (let i = 0; i < 50; i++) {
    const { jobs } = (await call(runner, 'next_jobs')) as {
      jobs: { task: Json; run_token: string }[];
    };
    const mine = jobs.find((j) => j.task.id === task.id);
    if (mine) return { task, token: mine.run_token };
    if (jobs.length === 0) break;
  }
  throw new Error('맡긴 일을 빌리지 못했어요');
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  api.service(CoreWorkers).on('blog.post.*', seen);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, {
    name: '돌무더기',
    siteUrl: api.baseUrl,
    version,
  });
  writer = await api.connectDevice(owner, 'link-writer');
  reader = await api.connectDevice(owner, 'link-reader');
  runner = await api.connectDevice(owner, 'link-runner');
  await grant('link-writer', ['write']);
  await grant('link-reader', ['write', 'read_all']);
  await grant('link-runner', ['run']);
  // 앞 테스트 파일이 남긴 이벤트를 치운다
  await drain();
});

after(async () => {
  for (const agent of agents)
    ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, { version: agent.version }),
    );
  await drain();
  await api.close();
});

describe('편집기 (REST)', () => {
  test('새 글에 잇고 다시 읽는다. 대표와 겹치는 참고와 겹친 참고는 빠지고 판은 그대로', async () => {
    const [a, b, c] = [await newWiki(false), await newWiki(true), await newWiki(true)];
    const post = await create({
      mainWikiId: a.id,
      refWikiIds: [c.id, b.id, b.id, a.id],
    });
    assert.equal(post.mainWikiId, a.id);
    const refs = [b.id, c.id].sort();
    assert.deepEqual(post.refWikiIds, refs);
    assert.equal(post.version, 1);
    const again = await read(post.id);
    assert.equal(again.mainWikiId, a.id);
    assert.deepEqual(again.refWikiIds, refs);
    assert.equal(again.revisionCount, 1);
    const rows = await db.sql`
      SELECT main_wiki_id FROM blog.posts WHERE id = ${String(post.id)}`;
    assert.equal(rows[0]?.main_wiki_id, a.id);
    const refRows = await db.sql`
      SELECT wiki_id FROM blog.post_wiki_refs WHERE post_id = ${String(post.id)} ORDER BY wiki_id`;
    assert.deepEqual(
      refRows.map((r) => r.wiki_id),
      refs,
    );
  });

  test('보내지 않으면 그대로, 대표 null과 참고 []는 비우기', async () => {
    const [a, b] = [await newWiki(true), await newWiki(true)];
    let post = await create({ mainWikiId: a.id, refWikiIds: [b.id] });

    const same = await save(post);
    assert.equal(same.version, post.version);
    assert.equal(same.mainWikiId, a.id);
    assert.deepEqual(same.refWikiIds, [b.id]);

    post = await save(post, { mainWikiId: null });
    assert.equal(post.version, 2);
    assert.equal(post.revised, false);
    assert.equal(post.mainWikiId, null);
    assert.deepEqual(post.refWikiIds, [b.id]);

    post = await save(post, { refWikiIds: [] });
    assert.deepEqual(post.refWikiIds, []);
    const read1 = await read(post.id);
    assert.equal(read1.mainWikiId, null);
    assert.deepEqual(read1.refWikiIds, []);
    assert.equal(read1.revisionCount, 1);
  });

  test('참고 20개까지 (21개는 400), 모양이 틀린 id도 400', async () => {
    const post = await create();
    const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
    const over = await saveAs(post, { refWikiIds: ids(21) });
    assert.equal(over.status, 400, over.text);
    assert.equal((over.json().fields as Json).refWikiIds, '20개 이하여야 해요');
    assert.equal((await saveAs(post, { refWikiIds: ['nope'] })).status, 400);
    assert.equal((await saveAs(post, { mainWikiId: 'nope' })).status, 400);
    const wikis = await Promise.all(Array.from({ length: 20 }, () => newWiki(true)));
    const full = await save(post, { refWikiIds: wikis.map((w) => w.id) });
    assert.equal((full.refWikiIds as string[]).length, 20);
  });

  test('없는 wiki는 404이고 글은 그대로', async () => {
    const post = await create();
    const missing = await saveAs(post, { mainWikiId: randomUUID() });
    assert.equal(missing.status, 404, missing.text);
    assert.equal((await saveAs(post, { refWikiIds: [randomUUID()] })).status, 404);
    assert.equal((await read(post.id)).version, post.version);
  });

  test('버전이 다르면 409', async () => {
    const wiki = await newWiki(true);
    const post = await create();
    await save(post, { title: named('고친 글') });
    const stale = await saveAs(post, { mainWikiId: wiki.id });
    assert.equal(stale.status, 409, stale.text);
    assert.equal((await read(post.id)).mainWikiId, null);
  });

  test('방문자에게는 글의 wiki id가 나오지 않는다', async () => {
    const wiki = await newWiki(false);
    const post = await setStatus(await create({ mainWikiId: wiki.id }), 'published');
    const url = `/api/posts/by-slug/${encodeURIComponent(String(post.slug))}`;
    const bySlug = await api.get(url);
    assert.equal(bySlug.status, 200, bySlug.text);
    assert.equal(bySlug.text.includes(String(wiki.id)), false);
    assert.equal('mainWikiId' in bySlug.json(), false);
    const list = await api.get('/api/posts');
    assert.equal(list.text.includes(String(wiki.id)), false);
    assert.equal(ok(await api.get(url, owner)).mainWikiId, wiki.id);
  });
});

describe('AI 도구 (MCP)', () => {
  test('초안에 잇고 blog_get_post로 다시 읽는다. 고칠 때 빼면 그대로, null과 []는 비우기', async () => {
    const [a, b] = [await newWiki(true), await newWiki(true)];
    const saved = await call(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      title: 'AI 초안',
      body_md: '본문',
      main_wiki_id: a.id,
      ref_wiki_ids: [b.id, a.id, b.id],
    });
    const got = await call(writer, 'blog_get_post', { post_id: saved.post_id });
    assert.equal(got.main_wiki_id, a.id);
    assert.deepEqual(got.ref_wiki_ids, [b.id]);

    const edit = (more: Json) => ({
      request_id: randomUUID(),
      post_id: saved.post_id,
      title: 'AI 초안',
      body_md: '본문',
      ...more,
    });
    const kept = await call(writer, 'blog_save_draft', edit({ base_version: saved.version }));
    assert.equal(kept.version, saved.version);

    const cleared = await call(
      writer,
      'blog_save_draft',
      edit({ base_version: saved.version, main_wiki_id: null }),
    );
    assert.equal(cleared.version, Number(saved.version) + 1);
    const noMain = await call(writer, 'blog_get_post', { post_id: saved.post_id });
    assert.equal(noMain.main_wiki_id, null);
    assert.deepEqual(noMain.ref_wiki_ids, [b.id]);

    await call(
      writer,
      'blog_save_draft',
      edit({ base_version: cleared.version, ref_wiki_ids: [] }),
    );
    const none = await call(writer, 'blog_get_post', { post_id: saved.post_id });
    assert.deepEqual(none.ref_wiki_ids, []);
  });

  test('참고 21개는 400', async () => {
    const { ok: done, body } = await tool(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      title: 'AI 초안',
      body_md: '본문',
      ref_wiki_ids: Array.from({ length: 21 }, () => randomUUID()),
    });
    assert.equal(done, false);
    assert.equal(body.code, 'invalid_request');
  });

  test('write뿐인 기기·에이전트에게 비공개 wiki는 없는 wiki와 똑같다', async () => {
    const hidden = await newWiki(false);
    const draft = (more: Json) => ({
      request_id: randomUUID(),
      title: 'AI 초안',
      body_md: '본문',
      ...more,
    });
    const { token } = await lease(['write']);
    for (const actor of [writer, token]) {
      const secret = await tool(actor, 'blog_save_draft', draft({ main_wiki_id: hidden.id }));
      const absent = await tool(actor, 'blog_save_draft', draft({ main_wiki_id: randomUUID() }));
      assert.equal(secret.ok, false);
      assert.equal(absent.ok, false);
      assert.deepEqual(secret.body, absent.body);
      assert.equal(secret.body.code, 'not_found');
      const inRefs = await tool(actor, 'blog_save_draft', draft({ ref_wiki_ids: [hidden.id] }));
      assert.deepEqual(inRefs.body, absent.body);
    }
    // read_all이 있으면 비공개 wiki도 잇는다
    const saved = await call(reader, 'blog_save_draft', draft({ main_wiki_id: hidden.id }));
    assert.equal(
      (await call(reader, 'blog_get_post', { post_id: saved.post_id })).main_wiki_id,
      hidden.id,
    );
  });

  test('주인이 비공개 wiki에 이은 초안을 write뿐인 기기가 읽어도 그 id는 나오지 않는다', async () => {
    const [hidden, open] = [await newWiki(false), await newWiki(true)];
    const hiddenRef = await newWiki(false);
    const post = await create({ mainWikiId: hidden.id, refWikiIds: [open.id, hiddenRef.id] });
    const res = await api.mcp(writer, 'tools/call', {
      name: 'blog_get_post',
      arguments: { post_id: post.id },
    });
    assert.equal(res.text.includes(String(hidden.id)), false);
    assert.equal(res.text.includes(String(hiddenRef.id)), false);
    const got = await call(writer, 'blog_get_post', { post_id: post.id });
    assert.equal(got.main_wiki_id, null);
    assert.deepEqual(got.ref_wiki_ids, [open.id]);
    // 연결을 보내지 않고 고치면 숨은 연결은 그대로 남는다
    await call(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: post.id,
      base_version: post.version,
      title: 'AI가 고친 제목',
      body_md: '본문',
    });
    assert.equal((await read(post.id)).mainWikiId, hidden.id);
  });

  test('공개된 글의 연결은 AI가 바꾸지 못한다', async () => {
    const [a, b] = [await newWiki(true), await newWiki(true)];
    const saved = await call(reader, 'blog_save_draft', {
      request_id: randomUUID(),
      title: 'AI 초안',
      body_md: '본문',
      main_wiki_id: a.id,
    });
    for (const status of ['published', 'unlisted']) {
      const now = await read(saved.post_id);
      const post = now.status === status ? now : await setStatus(now, status);
      const refused = await tool(reader, 'blog_save_draft', {
        request_id: randomUUID(),
        post_id: post.id,
        base_version: post.version,
        title: post.title,
        body_md: '본문',
        main_wiki_id: b.id,
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.body.code, 'forbidden');
      assert.equal((await read(post.id)).mainWikiId, a.id);
    }
  });

  test('버전이 다르면 409', async () => {
    const wiki = await newWiki(true);
    const saved = await call(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      title: 'AI 초안',
      body_md: '본문',
    });
    const post = await read(saved.post_id);
    await save(post, { title: named('사람이 고침') });
    const stale = await tool(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: saved.post_id,
      base_version: saved.version,
      title: 'AI 초안',
      body_md: '본문',
      main_wiki_id: wiki.id,
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.body.code, 'conflict');
  });
});

describe('그래프까지', () => {
  test('잇고 공개하면 일꾼을 거쳐 주인과 방문자 그래프의 wiki 아래에 나온다', async () => {
    const [a, b, c] = [await newWiki(true), await newWiki(true), await newWiki(true)];
    let post = await create({ mainWikiId: a.id, refWikiIds: [b.id] });
    await drain();
    // 임시 글은 사본에 오지 않는다: 공개해야 그래프에 나온다
    assert.equal(nodeOf(await ownerGraph(), post.id), undefined);

    post = await setStatus(post, 'published');
    await drain();
    for (const graph of [await ownerGraph(), await publicGraph()]) {
      const node = nodeOf(graph, post.id);
      assert.equal(node?.parent, a.id);
      assert.equal(node?.kind, 'post');
      assert.deepEqual(refsOf(graph, post.id), [b.id]);
    }

    // 연결만 바꿔도 새 판 없이 버전이 오르고 그래프가 따라온다
    post = await save(post, { mainWikiId: c.id, refWikiIds: [a.id] });
    assert.equal(post.revised, false);
    assert.equal(post.version, 3);
    await drain();
    for (const graph of [await ownerGraph(), await publicGraph()]) {
      assert.equal(nodeOf(graph, post.id)?.parent, c.id);
      assert.deepEqual(refsOf(graph, post.id), [a.id]);
    }

    // 제목과 연결을 한 번에 바꾸면 둘 다 반영된다
    const title = named('고친 제목');
    post = await save(post, { title, mainWikiId: b.id, refWikiIds: [] });
    assert.equal(post.revised, true);
    await drain();
    for (const graph of [await ownerGraph(), await publicGraph()]) {
      const node = nodeOf(graph, post.id);
      assert.equal(node?.parent, b.id);
      assert.equal(node?.label, title);
      assert.deepEqual(refsOf(graph, post.id), []);
    }

    // 대표를 비우면 그래프에서 빠진다
    post = await save(post, { mainWikiId: null });
    await drain();
    assert.equal(nodeOf(await ownerGraph(), post.id), undefined);
    assert.equal(nodeOf(await publicGraph(), post.id), undefined);
  });

  test('공개 취소하면 방문자에게서 빠지고 주인에게는 남는다. 휴지통이면 둘 다 빠지고 되살리면 돌아온다', async () => {
    const wiki = await newWiki(true);
    let post = await setStatus(await create({ mainWikiId: wiki.id }), 'published');
    await drain();
    post = await setStatus(post, 'draft');
    await drain();
    assert.equal(nodeOf(await publicGraph(), post.id), undefined);
    assert.equal(nodeOf(await ownerGraph(), post.id)?.parent, wiki.id);

    post = await setStatus(post, 'published');
    await drain();
    post = ok(
      await api.request('DELETE', `/api/posts/${post.id}`, owner, { version: post.version }),
    );
    await drain();
    assert.equal(nodeOf(await publicGraph(), post.id), undefined);
    assert.equal(nodeOf(await ownerGraph(), post.id), undefined);

    ok(
      await api.request('POST', `/api/posts/${post.id}/restore`, owner, { version: post.version }),
    );
    await drain();
    assert.equal(nodeOf(await publicGraph(), post.id)?.parent, wiki.id);
  });

  test('공개 글 뒤의 비공개 wiki는 방문자에게 이름 없는 자리로만 남는다', async () => {
    const [hidden, open] = [await newWiki(false), await newWiki(true)];
    const post = await setStatus(
      await create({ mainWikiId: hidden.id, refWikiIds: [open.id] }),
      'published',
    );
    await drain();

    const seen = await publicGraph();
    const node = nodeOf(seen, post.id);
    const place = String(node?.parent);
    assert.match(place, /^private-/);
    assert.deepEqual(
      seen.nodes.find((n) => n.id === place),
      { id: place, kind: 'wiki', label: '', parent: null, visibility: 'private' },
    );
    assert.deepEqual(refsOf(seen, post.id), [open.id]);
    const text = (await api.get('/api/graph/public')).text;
    assert.equal(text.includes(String(hidden.id)), false);
    assert.equal(text.includes(String(hidden.title)), false);

    assert.equal(nodeOf(await ownerGraph(), post.id)?.parent, hidden.id);
  });

  test('결재한 공개도 연결을 싣고, 결재 결과는 그대로다', async () => {
    const [a, b] = [await newWiki(true), await newWiki(true)];
    const { task, token } = await lease(['read_public', 'write']);
    const saved = await call(token, 'blog_save_draft', {
      request_id: 'first-draft',
      title: named('결재할 글'),
      body_md: '본문',
      main_wiki_id: a.id,
      ref_wiki_ids: [b.id],
    });
    const asked = await call(token, 'request_approval', {
      request_id: `approval-${saved.version}`,
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: saved.post_id,
      target_version: saved.version,
    });
    assert.equal(asked.status, 'pending');
    const approval = ok(await api.get(`/api/approvals/${asked.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
        version: approval.version,
        decision: 'approve',
      }),
    );
    await drain();

    assert.equal((await read(saved.post_id)).status, 'published');
    const event = seen.events.find(
      (e) => e.name === 'blog.post.published' && e.data.postId === saved.post_id,
    );
    const data = event?.data ?? {};
    assert.equal(data.approvalId, approval.id);
    assert.equal(data.outcome, 'done');
    assert.equal(data.mainWikiId, a.id);
    assert.deepEqual(data.refWikiIds, [b.id]);

    const graph = await publicGraph();
    assert.equal(nodeOf(graph, saved.post_id)?.parent, a.id);
    assert.deepEqual(refsOf(graph, saved.post_id), [b.id]);
    const done = ok(await api.get(`/api/tasks/${task.id}`, owner));
    assert.notEqual(done.status, 'waiting');
  });
});
