import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 에이전트를 러너에 묶기 (2026-11-14): 묶인 에이전트의 일은 그 러너만 빌린다 (꺼져 있으면 기다린다).
// 코드 러너 칸에는 묶지 않고, 칸에서만 도는 권한(code · make)이 있는 에이전트는 묶지 않는다. 팀장은 묶인 팀원을 안다 (bound).

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** 러너 둘 (run 권한 기기): 내 컴퓨터(mine)와 서버(server) */
const tokens: Record<string, string> = {};
/** task.runners의 id */
const runnerIds: Record<string, string> = {};

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function jobs(token: string): Promise<Json[]> {
  const res = await api.mcp(token, 'tools/call', { name: 'next_jobs', arguments: {} });
  assert.equal(res.status, 200, res.text);
  return (res.json().result as Json).structuredContent?.jobs ?? [];
}

const agent = async (name: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
      ...more,
    }),
    201,
  );
const current = async (id: unknown) =>
  (ok(await api.get('/api/agents', owner)).agents as Json[]).find((a) => a.id === id) as Json;
const patch = async (id: unknown, body: Json) =>
  api.request('PATCH', `/api/agents/${id}`, owner, {
    version: (await current(id)).version,
    ...body,
  });
const task = async (agentId: unknown) =>
  ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId,
      instruction: '일',
    }),
    201,
  );

async function runner(name: string): Promise<string> {
  const token = await api.connectDevice(owner, name);
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === name) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
  return token;
}

/** 러너가 처음 닿으면 줄이 생긴다. 기기 id로 줄의 id를 찾는다 */
async function rowOf(token: string, deviceName: string): Promise<string> {
  await jobs(token);
  const { devices } = ok(await api.get('/api/devices', owner));
  const device = (devices as Json[]).find((d) => d.name === deviceName) as Json;
  const { runners } = ok(await api.get('/api/runners', owner));
  return (runners as Json[]).find((r) => r.deviceId === device.id)?.id;
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '러너', siteUrl: api.baseUrl, version });
  for (const name of ['mine', 'server']) {
    tokens[name] = await runner(`pin-${name}`);
    runnerIds[name] = await rowOf(tokens[name] as string, `pin-${name}`);
  }
});
after(() => api.close());

/** 이 테스트의 일만 빌려 가게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('에이전트를 러너에 묶기', () => {
  test('방문자 · write 기기는 묶지 못한다 (403)', async () => {
    const a = await agent('남의');
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `pin-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer]) {
      const res = await api.request(
        'PATCH',
        `/api/agents/${a.id}`,
        TestUser.visitor,
        { version: a.version, runnerId: runnerIds.mine },
        headers,
      );
      assert.equal(res.status, 403, res.text);
    }
  });

  test('묶인 에이전트의 일은 그 러너만 빌린다. 풀면 아무 러너나', async () => {
    const a = await agent('내 컴퓨터');
    const pinned = ok(await patch(a.id, { runnerId: runnerIds.mine }));
    assert.equal(pinned.runnerId, runnerIds.mine);
    assert.equal(pinned.settingsRevision, a.settingsRevision + 1, '설정 판이 오른다');

    const t = await task(a.id);
    assert.deepEqual(await jobs(tokens.server as string), [], '다른 러너는 빌리지 않는다');
    const mine = await jobs(tokens.mine as string);
    assert.deepEqual(
      mine.map((j) => j.task.id),
      [t.id],
    );

    assert.equal(mine[0]?.agent.bound, true, '러너가 나눈 폴더를 여는 표시');

    ok(await patch(a.id, { runnerId: null }));
    const t2 = await task(a.id);
    const server = await jobs(tokens.server as string);
    assert.deepEqual(
      server.map((j) => j.task.id),
      [t2.id],
    );
    assert.equal(server[0]?.agent.bound, false);
  });

  test('만들 때 묶을 수 있고, 팀장은 묶인 팀원을 안다 (bound)', async () => {
    const lead = await agent('팀장');
    const member = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: `내 폴더 ${randomUUID().slice(0, 6)}`,
        tool: 'claude',
        scopes: ['read_public'],
        reportsTo: lead.id,
        runnerId: runnerIds.mine,
      }),
      201,
    );
    assert.equal(member.runnerId, runnerIds.mine);
    await task(lead.id);
    const [job] = await jobs(tokens.server as string);
    const seen = ((job?.team ?? []) as Json[]).find((m) => m.agent_id === member.id);
    assert.equal(seen?.bound, true);
  });

  test('칸에는 묶지 않고, code · make가 있으면 묶지 않는다 (422). 없는 러너는 404', async () => {
    const slot = await api.codeRunner('7');
    await jobs(slot);
    const { runners } = ok(await api.get('/api/runners', owner));
    const sandbox = (runners as Json[]).find((r) => r.sandbox === true);
    assert.ok(sandbox, '칸은 sandbox로 남는다');
    assert.equal((runners as Json[]).find((r) => r.id === runnerIds.mine)?.sandbox, false);

    const a = await agent('일반');
    assert.equal((await patch(a.id, { runnerId: sandbox.id })).status, 422);
    const maker = await agent('제작', { scopes: ['make'] });
    assert.equal((await patch(maker.id, { runnerId: runnerIds.mine })).status, 422);
    assert.equal((await patch(a.id, { runnerId: randomUUID() })).status, 404);

    ok(await patch(a.id, { runnerId: runnerIds.mine }));
    assert.equal((await patch(a.id, { scopes: ['make'] })).status, 422, '묶인 채로 make');
    const both = ok(await patch(a.id, { scopes: ['make'], runnerId: null }));
    assert.deepEqual([both.scopes, both.runnerId], [['make'], null], '풀면서 make는 된다');
  });
});
