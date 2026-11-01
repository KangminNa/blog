import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, DomainEvent, Outbox, OutboxWorker } from '../../platform';

// 세션 정리 요청: 자동 정리 설정, 저장 뒤 일 요청, 쌓인 세션 요청. 이벤트는 outbox와 일꾼을 실제로 거친다.
// 마지막은 가짜 러너로 세션 저장부터 그래프까지 한 바퀴 돈다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
let laptop: string;
let runner: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  assert.notEqual(result.isError, true, result.content[0]?.text);
  return result.structuredContent ?? {};
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

const save = async (source: string, did: string, title = '로그인 고치기'): Promise<Json> =>
  tool(laptop, 'save_session', {
    request_id: randomUUID(),
    source_session_id: source,
    tool: 'claude-code',
    project: 'cairn',
    title,
    did,
  });

const settings = async (): Promise<Json> => ok(await api.get('/api/tidy/settings', owner));

const turn = async (autoTidy: boolean): Promise<Json> => {
  const { version } = await settings();
  return ok(await api.request('PUT', '/api/tidy/settings', owner, { autoTidy, version }));
};

const queued = async (): Promise<Json[]> =>
  ok(await api.get('/api/tasks?status=queued', owner)).tasks as Json[];

/** 이 세션을 대상으로 대기 중인 작업 */
const tidyTasks = async (sessionId: unknown): Promise<Json[]> =>
  (await queued()).filter((t) => (t.target as Json | null)?.id === sessionId);

const backlog = (as: TestUser = owner) => api.request('POST', '/api/tidy/backlog', as);

/** 이 테스트의 세션과 일만 보이게 앞 테스트가 남긴 것을 치운다 */
beforeEach(async () => {
  await db.sql`DELETE FROM vault.tidy_settings`;
  await db.sql`UPDATE vault.nodes SET deleted_at = now() WHERE kind = 'session' AND deleted_at IS NULL`;
  await drain();
  for (let tasks = await queued(); tasks.length > 0; tasks = await queued())
    for (const { id, version } of tasks)
      ok(await api.request('POST', `/api/tasks/${id}/cancel`, owner, { version }));
  const { agents } = ok(await api.get('/api/agents', owner)) as {
    agents: { id: string; status: string; version: number }[];
  };
  for (const { id, status, version } of agents)
    if (status === 'active')
      ok(await api.request('POST', `/api/agents/${id}/pause`, owner, { version }));
});

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
  laptop = await api.connectDevice(owner, 'tidy-laptop');
  runner = await api.connectDevice(owner, 'tidy-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; version: number }[];
  };
  const device = devices.find((d) => d.name === 'tidy-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: ['run'],
      version: device?.version,
    }),
  );
});

after(async () => {
  await db.sql`DELETE FROM vault.tidy_settings`;
  await api.close();
});

describe('누가 쓸 수 있나', () => {
  test('방문자는 정리 설정과 재처리에 닿을 수 없다', async () => {
    assert.equal((await api.get('/api/tidy/settings')).status, 403);
    const put = await api.request('PUT', '/api/tidy/settings', TestUser.visitor, {
      autoTidy: true,
      version: 0,
    });
    assert.equal(put.status, 403);
    assert.equal((await backlog(TestUser.visitor)).status, 403);
  });

  test('기기는 주인의 일을 할 수 없다', async () => {
    const headers = { authorization: `Bearer ${laptop}` };
    const res = await fetch(`${api.baseUrl}/api/tidy/settings`, { headers });
    assert.equal(res.status, 403);
    const post = await fetch(`${api.baseUrl}/api/tidy/backlog`, { method: 'POST', headers });
    assert.equal(post.status, 403);
  });
});

describe('자동 정리 설정', () => {
  test('행이 없으면 꺼짐이고 version은 0이다', async () => {
    assert.deepEqual(await settings(), { autoTidy: false, version: 0 });
  });

  test('켜면 행이 생기고 version이 오른다', async () => {
    assert.deepEqual(await turn(true), { autoTidy: true, version: 1 });
    assert.deepEqual(await turn(false), { autoTidy: false, version: 2 });
    assert.deepEqual(await turn(false), { autoTidy: false, version: 2 }, '같은 값이면 그대로');
  });

  test('version이 어긋나면 409, 모양이 틀리면 400', async () => {
    await turn(true);
    const stale = await api.request('PUT', '/api/tidy/settings', owner, {
      autoTidy: false,
      version: 0,
    });
    assert.equal(stale.status, 409);
    const wrong = await api.request('PUT', '/api/tidy/settings', owner, { autoTidy: 'yes' });
    assert.equal(wrong.status, 400);
    assert.deepEqual(await settings(), { autoTidy: true, version: 1 });
  });
});

describe('저장 뒤 자동 정리', () => {
  test('꺼져 있으면 작업이 없고 이벤트는 처리됨으로 끝난다', async () => {
    const { session_id: id } = await save('off', '한 일');
    await drain();
    assert.equal((await tidyTasks(id)).length, 0);
    assert.equal(await api.unprocessed('vault.session.saved'), 0);
  });

  test('켜져 있으면 판마다 작업이 하나다. 같은 내용은 판이 없어 작업도 없다', async () => {
    await turn(true);
    const { session_id: id } = await save('on', '첫 판');
    await drain();
    const [first, ...none] = await tidyTasks(id);
    assert.equal(none.length, 0);
    assert.equal(first?.kind, 'tidy_session');
    assert.equal(first?.title, '세션 정리: 로그인 고치기');
    assert.equal((first?.target as Json | undefined)?.kind, 'session');
    assert.equal(first?.status, 'queued');

    await save('on', '첫 판');
    await drain();
    assert.equal((await tidyTasks(id)).length, 1, '같은 내용은 판이 아니다');

    await save('on', '둘째 판');
    await drain();
    assert.equal((await tidyTasks(id)).length, 2);
  });

  test('같은 이벤트가 두 번 와도 작업은 하나다', async () => {
    await turn(true);
    const { session_id: id } = await save('again', '한 일');
    await drain();
    const [row] = await db.sql`SELECT space_id FROM vault.sessions WHERE node_id = ${String(id)}`;
    const event = new DomainEvent('vault.session.saved', 1, String(row?.space_id), {
      sessionId: id,
      seq: 1,
    });
    await db.transaction((tx) => new Outbox(tx).publish([event]));
    await drain();
    assert.equal((await tidyTasks(id)).length, 1);
  });

  test('긴 제목은 잘려도 일 요청이 실패하지 않는다', async () => {
    await turn(true);
    const { session_id: id } = await save('long', '한 일', 'ㄱ'.repeat(200));
    await drain();
    const [task] = await tidyTasks(id);
    assert.equal(String(task?.title).length, 200);
  });

  test('휴지통의 세션은 요청하지 않는다', async () => {
    await turn(true);
    const { session_id: id } = await save('trashed', '한 일');
    await db.sql`UPDATE vault.nodes SET deleted_at = now() WHERE id = ${String(id)}`;
    await drain();
    assert.equal((await tidyTasks(id)).length, 0);
  });
});

describe('쌓인 세션 정리', () => {
  test('대표 wiki가 없는 세션을 오래된 순으로 20개까지, 꺼져 있어도 요청한다', async () => {
    const ids: unknown[] = [];
    for (let i = 0; i < 23; i++) ids.push((await save(`old-${i}`, `일 ${i}`)).session_id);
    await drain();

    assert.deepEqual(ok(await backlog()), { requested: 20, remaining: 3 });
    await drain();
    for (const id of ids.slice(0, 20)) assert.equal((await tidyTasks(id)).length, 1);
    for (const id of ids.slice(20)) assert.equal((await tidyTasks(id)).length, 0);
  });

  test('다시 눌러도 작업은 늘지 않는다', async () => {
    const { session_id: id } = await save('twice', '한 일');
    await drain();
    await Promise.all([backlog(), backlog()]);
    ok(await backlog());
    await drain();
    assert.equal((await tidyTasks(id)).length, 1);
  });

  test('자동 정리가 이미 요청한 판은 겹치지 않는다', async () => {
    await turn(true);
    const { session_id: id } = await save('auto', '한 일');
    await drain();
    ok(await backlog());
    await drain();
    assert.equal((await tidyTasks(id)).length, 1);
  });

  test('대표 wiki가 있는 세션은 빠지고 없으면 0이다', async () => {
    assert.deepEqual(ok(await backlog()), { requested: 0, remaining: 0 });
    const { session_id: id } = await save('assigned', '한 일');
    const wiki = ok(
      await api.request('POST', '/api/wikis', owner, {
        requestId: randomUUID(),
        title: `자리 ${randomUUID()}`,
      }),
      201,
    );
    await db.sql`
      UPDATE vault.sessions SET wiki_id = ${String(wiki.id)} WHERE node_id = ${String(id)}`;
    assert.deepEqual(ok(await backlog()), { requested: 0, remaining: 0 });
  });
});

describe('가짜 러너', () => {
  const newAgent = async (scopes: string[]): Promise<Json> =>
    ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: '정리',
        tool: 'claude',
        scopes,
      }),
      201,
    );

  const nextJobs = async (): Promise<Json[]> => (await tool(runner, 'next_jobs')).jobs as Json[];

  test('tidy가 없는 에이전트뿐이면 작업은 대기열에 남는다', async () => {
    await newAgent(['read_all']);
    await turn(true);
    const { session_id: id } = await save('waiting', '한 일');
    await drain();
    assert.deepEqual(await nextJobs(), []);
    const [task] = await tidyTasks(id);
    assert.equal(task?.status, 'queued');
    assert.equal(task?.agentId, null);
  });

  test('세션 저장 → 작업 → 빌리기 → 변경 묶음 → 그래프', async () => {
    const agent = await newAgent(['read_all', 'tidy']);
    await turn(true);
    const { session_id: id } = await save('full-circle', '세션 저장을 고쳤다', '세션 저장');
    await drain();
    const title = `세션 저장 정리 ${randomUUID()}`;

    const [job] = await nextJobs();
    const task = job?.task as Json;
    const target = job?.target as Json;
    assert.equal(job?.skill, 'cairn-tidy');
    assert.equal(target.kind, 'session');
    assert.equal(target.id, id);
    assert.equal((job?.agent as Json | undefined)?.id, agent.id);
    const token = String(job?.run_token);

    // 스킬의 순서: 세션 읽기 → wiki 찾기 → 변경 묶음 하나
    const note = await tool(token, 'get_session', { session_id: id });
    assert.equal(note.title, '세션 저장');
    await tool(token, 'search_wikis', { query: '세션' });
    const set = await tool(token, 'submit_changes', {
      request_id: randomUUID(),
      message: '세션 저장 정리',
      ops: [
        { op: 'wiki.create', payload: { title, body_md: '## 한 일\n고쳤다' } },
        {
          op: 'session.assign',
          target_id: id,
          base_version: target.version,
          payload: { wiki_id: '@1' },
        },
      ],
    });
    const ops = set.ops as Json[];
    assert.deepEqual(
      ops.map((o) => o.status),
      ['applied', 'applied'],
    );

    await tool(runner, 'submit_result', {
      task_id: task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '정리했어요' },
    });
    assert.equal(ok(await api.get(`/api/tasks/${task.id}`, owner)).status, 'done');

    const graph = ok(await api.get('/api/graph', owner)) as { nodes: Json[] };
    const wiki = graph.nodes.find((n) => n.kind === 'wiki' && n.label === title);
    const session = graph.nodes.find((n) => n.id === id);
    assert.equal(session?.parent, wiki?.id);
    assert.equal(wiki?.visibility, 'private', 'AI가 쓴 wiki는 비공개다');

    const open = await api.get('/api/graph/public');
    assert.equal(open.text.includes(title), false);
  });
});
