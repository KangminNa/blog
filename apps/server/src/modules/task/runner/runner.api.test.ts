import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// /api/runners: 보는 사람별 결과 (방문자 · write 기기 · 주인), 러너가 닿은 때와 일 받기 켜기·끄기.
// 러너는 MCP(next_jobs · report_progress)로 닿고, 주인은 REST로 본다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'runner-writer')}` };
});
after(() => api.close());

/** 이 테스트의 일만 보이게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 콘솔의 러너 추가로 만든 러너 기기 */
async function newRunner(): Promise<{ id: string; token: string }> {
  return ok(
    await api.request('POST', '/api/devices/runner', owner, {
      requestId: randomUUID(),
      name: `러너-${randomUUID().slice(0, 8)}`,
    }),
    201,
  ) as { id: string; token: string };
}

/** 러너가 MCP 도구 하나를 부른다 */
async function call(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.notEqual(result.isError, true, res.text);
  return result.structuredContent ?? {};
}

async function runnerOf(deviceId: string): Promise<Json | undefined> {
  const { runners } = ok(await api.get('/api/runners', owner)) as { runners: Json[] };
  return runners.find((r) => r.deviceId === deviceId);
}

async function queuedTask(): Promise<Json> {
  const agent = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '러너 시험',
      tool: 'claude',
    }),
    201,
  );
  return ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      instruction: '러너 메뉴 확인',
    }),
    201,
  );
}

describe('러너 (/api/runners)', () => {
  test('방문자와 write 기기는 보지도 바꾸지도 못한다 (403)', async () => {
    for (const headers of [{}, writer]) {
      const list = await api.request('GET', '/api/runners', TestUser.visitor, undefined, headers);
      assert.equal(list.status, 403, list.text);
      const flip = await api.request(
        'POST',
        `/api/runners/${randomUUID()}/accepting`,
        TestUser.visitor,
        { accepting: false, version: 1 },
        headers,
      );
      assert.equal(flip.status, 403, flip.text);
    }
  });

  test('러너가 일을 물으면 목록에 생기고 연결됨으로 보인다', async () => {
    const device = await newRunner();
    assert.equal(await runnerOf(device.id), undefined, '닿기 전에는 없다');
    await call(device.token, 'next_jobs');
    const runner = await runnerOf(device.id);
    assert.equal(runner?.accepting, true, '처음에는 일을 받는다');
    assert.equal(runner?.online, true);
    assert.equal(runner?.task, null);
    assert.ok(Date.now() - new Date(String(runner?.lastSeenAt)).getTime() < 60_000);
  });

  test('AI 토큰이 없어 ai_login만 물어도 연결됨으로 보인다 (토큰이 없는 러너는 일을 빌리지 않는다)', async () => {
    const device = await newRunner();
    await api.mcp(device.token, 'tools/call', { name: 'ai_login', arguments: { tool: 'claude' } });
    assert.equal((await runnerOf(device.id))?.online, true);
  });

  test('일 받기를 끄면 대기 중인 일이 있어도 빈 목록, 켜면 다시 빌린다. 일하는 중이면 그 일이 보인다', async () => {
    const device = await newRunner();
    await call(device.token, 'next_jobs');
    const before = (await runnerOf(device.id)) as Json;
    const off = ok(
      await api.request('POST', `/api/runners/${before.id}/accepting`, owner, {
        accepting: false,
        version: before.version,
      }),
    );
    assert.equal(off.accepting, false);

    const task = await queuedTask();
    assert.deepEqual((await call(device.token, 'next_jobs')).jobs, [], '끈 러너에게는 주지 않는다');
    assert.equal((await runnerOf(device.id))?.online, true, '꺼도 연결은 그대로');

    const stale = await api.request('POST', `/api/runners/${before.id}/accepting`, owner, {
      accepting: true,
      version: before.version,
    });
    assert.equal(stale.status, 409, '늦은 쓰기는 덮지 않는다');
    ok(
      await api.request('POST', `/api/runners/${before.id}/accepting`, owner, {
        accepting: true,
        version: off.version,
      }),
    );
    const jobs = (await call(device.token, 'next_jobs')).jobs as { task: Json }[];
    assert.equal(jobs[0]?.task.id, task.id);
    assert.deepEqual((await runnerOf(device.id))?.task, {
      id: task.id,
      title: '러너 메뉴 확인',
    });

    // 일하는 동안에는 진행 보고로 닿은 때가 늘어난다
    await db.sql`
      UPDATE task.runners SET last_seen_at = now() - interval '5 minutes'
      WHERE device_id = ${device.id}`;
    assert.equal((await runnerOf(device.id))?.online, false);
    await call(device.token, 'report_progress', { task_id: task.id, events: [] });
    assert.equal((await runnerOf(device.id))?.online, true);
  });

  test('없는 러너는 404, 모양이 틀리면 400', async () => {
    const missing = await api.request('POST', `/api/runners/${randomUUID()}/accepting`, owner, {
      accepting: false,
      version: 1,
    });
    assert.equal(missing.status, 404, missing.text);
    const shape = await api.request('POST', `/api/runners/${randomUUID()}/accepting`, owner, {
      accepting: 'no',
      version: 1,
    });
    assert.equal(shape.status, 400, shape.text);
  });
});
