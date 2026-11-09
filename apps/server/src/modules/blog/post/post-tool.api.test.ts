import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// AI 도구의 글 쓰기: blog_get_post · blog_save_draft. 기기와 에이전트의 작업 토큰이 같은 도구를 쓴다.
// 초안까지만 쓸 수 있고, 공개된 글은 주인만 고친다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** 이 파일이 만든 에이전트 (끝나면 멈춘다) */
const agents: Json[] = [];
/** write 권한을 준 기기 */
let writer: string;
/** 기본 권한만 있는 기기 */
let laptop: string;
/** run 권한을 준 기기 (러너) */
let runner: string;

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

async function toolNames(token: string): Promise<string[]> {
  const res = await api.mcp(token, 'tools/list');
  assert.equal(res.status, 200, res.text);
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

/** 초안 저장. 성공을 기대할 때 */
async function draft(token: string, more: Json = {}): Promise<Json> {
  const { ok: done, body } = await tool(token, 'blog_save_draft', {
    request_id: randomUUID(),
    title: 'AI가 쓴 초안',
    body_md: '본문',
    ...more,
  });
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

/** 주인이 공개 범위를 바꾼다 */
async function setStatus(id: unknown, version: unknown, status: string): Promise<Json> {
  return ok(await api.request('POST', `/api/posts/${id}/status`, owner, { version, status }));
}

async function revisions(postId: unknown) {
  return db.sql`
    SELECT actor_type, actor_id FROM blog.post_revisions WHERE post_id = ${String(postId)} ORDER BY seq`;
}

/** 에이전트를 만들고 일을 맡겨 러너가 빌린다. 돌려주는 값은 그 에이전트의 작업 토큰 */
async function runToken(scopes: readonly string[]): Promise<{ token: string; agentId: string }> {
  const agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      tool: 'claude',
      scopes,
    }),
    201,
  );
  agents.push(agent);
  const task = ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      instruction: '소재로 초안을 써 주세요',
    }),
    201,
  );
  // 앞 테스트 파일이 남긴 일이 먼저 올 수 있어서 이 일이 나올 때까지 빌린다
  for (let i = 0; i < 50; i++) {
    const { body } = await tool(runner, 'next_jobs');
    const jobs = (body.jobs ?? []) as { task: Json; run_token: string }[];
    const mine = jobs.find((j) => j.task.id === task.id);
    if (mine) return { token: mine.run_token, agentId: String(agent.id) };
    if (jobs.length === 0) break;
  }
  throw new Error('맡긴 일을 빌리지 못했어요');
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
  laptop = await api.connectDevice(owner, 'draft-laptop');
  writer = await api.connectDevice(owner, 'draft-writer');
  runner = await api.connectDevice(owner, 'draft-runner');
  await grant('draft-writer', ['write']);
  await grant('draft-runner', ['run']);
});

after(async () => {
  // 담당 없는 일은 가장 먼저 만든 움직이는 에이전트가 맡는다. 다음 테스트 파일의 일을 가져가지 않게 멈춘다
  for (const agent of agents)
    ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, {
        version: agent.version,
      }),
    );
  // 다음 테스트 파일이 받는 이벤트가 밀리지 않게 이 파일이 남긴 이벤트를 치운다
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
});

describe('권한', () => {
  test('write 권한이 없으면 도구가 보이지 않고 부를 수도 없다', async () => {
    const names = await toolNames(laptop);
    assert.equal(names.includes('blog_get_post'), false);
    assert.equal(names.includes('blog_save_draft'), false);
    const { ok: done, body } = await tool(laptop, 'blog_save_draft', {
      request_id: randomUUID(),
      title: '막힘',
      body_md: '본문',
    });
    assert.equal(done, false);
    assert.equal(body.code, 'forbidden');
  });

  test('write 권한이면 보인다', async () => {
    const names = await toolNames(writer);
    for (const name of ['blog_get_post', 'blog_save_draft', 'basket_get'])
      assert.ok(names.includes(name), name);
  });
});

describe('blog_save_draft (기기)', () => {
  test('새 초안: 임시 상태, 판의 작성자는 AI, url은 편집기', async () => {
    const saved = await draft(writer, { tags: ['ai'] });
    assert.equal(saved.status, 'draft');
    assert.equal(saved.version, 1);
    assert.equal(saved.url, `${api.baseUrl}/admin/posts/${saved.post_id}`);
    const [revision] = await revisions(saved.post_id);
    assert.equal(revision?.actor_type, 'ai');
  });

  test('초안의 제목 · 본문에 섞인 비밀값은 판이 되기 전에 지운다', async () => {
    const github = `gh${'p'}_${'a'.repeat(36)}`;
    const saved = await draft(writer, {
      title: `배포 메모 ${github}`,
      body_md: `토큰은 ${github}\n\npassword=hunter2025`,
    });
    const [stored] = await db.sql<{ title: string; body_md: string }[]>`
      SELECT r.title, r.body_md FROM blog.post_revisions r
      WHERE r.post_id = ${String(saved.post_id)} ORDER BY r.seq DESC LIMIT 1`;
    assert.equal(stored?.title, '배포 메모 [지움: GitHub 토큰]');
    assert.equal(stored?.body_md, '토큰은 [지움: GitHub 토큰]\n\npassword=[지움: 비밀번호·키 값]');
  });

  test('주인이 편집기로 쓴 글은 지우지 않는다 (사람이 정한 것)', async () => {
    const github = `gh${'p'}_${'b'.repeat(36)}`;
    const created = ok(
      await api.request('POST', '/api/posts', owner, {
        requestId: randomUUID(),
        title: '주인의 메모',
        body: `예시 토큰 ${github}`,
      }),
      201,
    );
    const [stored] = await db.sql<{ body_md: string }[]>`
      SELECT body_md FROM blog.post_revisions WHERE post_id = ${String(created.id)}`;
    assert.equal(stored?.body_md, `예시 토큰 ${github}`);
  });

  test('방문자에게는 초안이 보이지 않는다', async () => {
    const saved = await draft(writer, { title: `숨은 초안 ${randomUUID()}` });
    const { posts } = (await api.get('/api/posts')).json() as { posts: { title: string }[] };
    assert.equal(
      posts.some((p) => p.title.startsWith('숨은 초안')),
      false,
    );
    const mine = ok(await api.get(`/api/posts/${saved.post_id}`, owner));
    assert.equal((await api.get(`/api/posts/by-slug/${String(mine.slug)}`)).status, 404);
  });

  test('같은 request_id는 글 하나: 응답을 못 받아 다시 보내도 처음 글을 돌려준다', async () => {
    const args = { request_id: randomUUID(), title: '다시 보낸 초안', body_md: '본문' };
    const first = await tool(writer, 'blog_save_draft', args);
    const again = await tool(writer, 'blog_save_draft', args);
    assert.equal(first.body.post_id, again.body.post_id);
    assert.equal(again.body.version, first.body.version);
  });

  test('고쳐 쓰기: 읽고 받은 version으로 새 판. 주소·태그는 그대로', async () => {
    const saved = await draft(writer, { title: '고칠 초안', tags: ['유지'] });
    const before = ok(await api.get(`/api/posts/${saved.post_id}`, owner));
    const read = await tool(writer, 'blog_get_post', { post_id: saved.post_id });
    assert.deepEqual(read.body, {
      post_id: saved.post_id,
      title: '고칠 초안',
      body_md: '본문',
      status: 'draft',
      version: 1,
      tags: ['유지'],
      main_wiki_id: null,
      ref_wiki_ids: [],
    });
    const edited = await draft(writer, {
      post_id: saved.post_id,
      base_version: read.body.version,
      title: '고친 초안',
      body_md: '고친 본문',
    });
    assert.equal(edited.post_id, saved.post_id);
    assert.equal(edited.version, 2);
    const shown = ok(await api.get(`/api/posts/${saved.post_id}`, owner));
    assert.equal(shown.title, '고친 초안');
    assert.equal(shown.body, '고친 본문');
    assert.equal(shown.slug, before.slug);
    assert.deepEqual(shown.tags, ['유지']);
    assert.equal(shown.revisionCount, 2);
  });

  test('태그를 보내면 바뀐다', async () => {
    const saved = await draft(writer, { tags: ['옛'] });
    await draft(writer, {
      post_id: saved.post_id,
      base_version: saved.version,
      tags: ['새'],
    });
    const shown = ok(await api.get(`/api/posts/${saved.post_id}`, owner));
    assert.deepEqual(shown.tags, ['새']);
  });

  test('그사이 사람이 고쳤으면 409: 덮어쓰지 않는다', async () => {
    const saved = await draft(writer);
    ok(
      await api.request('PUT', `/api/posts/${saved.post_id}`, owner, {
        version: saved.version,
        title: '사람이 고침',
        body: '사람 본문',
      }),
    );
    const { ok: done, body } = await tool(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: saved.post_id,
      base_version: saved.version,
      title: 'AI가 덮으려 함',
      body_md: 'AI 본문',
    });
    assert.equal(done, false);
    assert.equal(body.code, 'conflict');
    const shown = ok(await api.get(`/api/posts/${saved.post_id}`, owner));
    assert.equal(shown.title, '사람이 고침');
  });

  test('409가 난 request_id는 쓰이지 않아서 고친 뒤 다시 보낼 수 있다', async () => {
    const saved = await draft(writer);
    const args = {
      request_id: randomUUID(),
      post_id: saved.post_id,
      title: '다시 고침',
      body_md: '본문 둘',
    };
    const wrong = await tool(writer, 'blog_save_draft', { ...args, base_version: 99 });
    assert.equal(wrong.body.code, 'conflict');
    const right = await tool(writer, 'blog_save_draft', { ...args, base_version: saved.version });
    assert.equal(right.ok, true, JSON.stringify(right.body));
    assert.equal(right.body.version, 2);
  });

  test('고칠 때 base_version을 빼면 고칠 칸을 알려 준다', async () => {
    const saved = await draft(writer);
    const { ok: done, body } = await tool(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: saved.post_id,
      title: '버전 없음',
      body_md: '본문',
    });
    assert.equal(done, false);
    assert.equal(body.code, 'invalid_request');
    assert.ok((body.fields as Json).base_version);
  });

  test('공개·링크 공개 글은 고칠 수 없다 (403). 내용은 그대로', async () => {
    for (const status of ['published', 'unlisted']) {
      const saved = await draft(writer, { title: `공개할 글 ${status}` });
      const open = await setStatus(saved.post_id, saved.version, status);
      const { ok: done, body } = await tool(writer, 'blog_save_draft', {
        request_id: randomUUID(),
        post_id: saved.post_id,
        base_version: open.version,
        title: 'AI가 공개 글을 고침',
        body_md: '바뀌면 안 됨',
      });
      assert.equal(done, false, status);
      assert.equal(body.code, 'forbidden', status);
      const shown = ok(await api.get(`/api/posts/${saved.post_id}`, owner));
      assert.equal(shown.title, `공개할 글 ${status}`);
    }
  });

  test('주인은 공개한 글을 그대로 고칠 수 있다', async () => {
    const saved = await draft(writer);
    const open = await setStatus(saved.post_id, saved.version, 'published');
    ok(
      await api.request('PUT', `/api/posts/${saved.post_id}`, owner, {
        version: open.version,
        title: '주인이 고침',
        body: '주인 본문',
      }),
    );
    const list = await revisions(saved.post_id);
    assert.deepEqual(
      list.map((r) => r.actor_type),
      ['ai', 'user'],
    );
  });

  test('없는 글·휴지통 글: 읽으면 404, 고치면 오류', async () => {
    const missing = await tool(writer, 'blog_get_post', { post_id: randomUUID() });
    assert.equal(missing.body.code, 'not_found');
    const none = await tool(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: randomUUID(),
      base_version: 1,
      title: '없는 글',
      body_md: '본문',
    });
    assert.equal(none.body.code, 'not_found');

    const saved = await draft(writer);
    ok(
      await api.request('DELETE', `/api/posts/${saved.post_id}`, owner, {
        version: saved.version,
      }),
    );
    const trashed = await tool(writer, 'blog_get_post', { post_id: saved.post_id });
    assert.equal(trashed.body.code, 'not_found');
    const blocked = await tool(writer, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: saved.post_id,
      base_version: Number(saved.version) + 1,
      title: '휴지통 글',
      body_md: '본문',
    });
    assert.equal(blocked.body.code, 'rule_violation');
  });
});

describe('에이전트의 작업 토큰', () => {
  test('write가 있으면 소재를 읽고, 초안을 쓰고, 공개 글을 고치면 403', async () => {
    const { token, agentId } = await runToken(['write']);
    ok(
      await api.request('POST', '/api/basket/items', owner, {
        requestId: randomUUID(),
        kind: 'note',
        note: '에이전트가 읽을 메모',
      }),
      201,
    );
    const basket = await tool(token, 'basket_get');
    assert.equal(basket.ok, true, JSON.stringify(basket.body));
    assert.ok(
      (basket.body.items as Json[]).some((i) => i.note === '에이전트가 읽을 메모'),
      JSON.stringify(basket.body),
    );

    const saved = await draft(token, { title: '에이전트의 초안' });
    assert.equal(saved.status, 'draft');
    const [revision] = await revisions(saved.post_id);
    assert.equal(revision?.actor_type, 'ai');
    assert.equal(revision?.actor_id, agentId);

    const read = await tool(token, 'blog_get_post', { post_id: saved.post_id });
    assert.equal(read.body.title, '에이전트의 초안');
    const edited = await draft(token, {
      post_id: saved.post_id,
      base_version: read.body.version,
      title: '에이전트가 고친 초안',
    });
    assert.equal(edited.version, 2);

    const open = await setStatus(saved.post_id, edited.version, 'published');
    const { ok: done, body } = await tool(token, 'blog_save_draft', {
      request_id: randomUUID(),
      post_id: saved.post_id,
      base_version: open.version,
      title: '공개 글을 덮으려 함',
      body_md: '바뀌면 안 됨',
    });
    assert.equal(done, false);
    assert.equal(body.code, 'forbidden');
    const shown = ok(await api.get(`/api/posts/${saved.post_id}`, owner));
    assert.equal(shown.title, '에이전트가 고친 초안');
  });

  test('같은 에이전트라도 작업이 다르면 request_id를 따로 센다', async () => {
    const first = await runToken(['write']);
    const second = await runToken(['write']);
    const request_id = randomUUID();
    const a = await draft(first.token, { request_id, title: '첫 작업의 글' });
    const b = await draft(second.token, { request_id, title: '둘째 작업의 글' });
    assert.notEqual(a.post_id, b.post_id);
  });

  test('write가 없는 에이전트에게는 도구가 없다', async () => {
    const { token } = await runToken(['read_public']);
    assert.equal((await toolNames(token)).includes('blog_save_draft'), false);
    const { ok: done, body } = await tool(token, 'basket_get');
    assert.equal(done, false);
    assert.equal(body.code, 'forbidden');
  });

  test('작업 토큰은 REST에서 요청자가 되지 않는다', async () => {
    const { token } = await runToken(['write']);
    const res = await api.request('GET', '/api/basket/items', TestUser.visitor, undefined, {
      authorization: `Bearer ${token}`,
    });
    assert.equal(res.status, 403);
  });
});
