import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';
import { HeartbeatJob } from './heartbeat.job';

// PUT /api/agents/:id/heartbeat: 보는 사람별 결과 (방문자 · write 기기 · 주인)와 일꾼의 깨우기.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let job: HeartbeatJob;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  job = api.service(HeartbeatJob);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'heartbeat-writer')}` };
});
after(() => api.close());

/** 이 테스트의 하트비트만 깨우게 앞 테스트의 것을 끈다 */
beforeEach(async () => {
  await db.sql`UPDATE task.heartbeats SET enabled = false, next_run_at = NULL`;
});

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function newAgent(more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '확인 담당',
      tool: 'claude',
      ...more,
    }),
    201,
  );
}

const DAILY = {
  enabled: true,
  mode: 'daily',
  atTime: '09:30',
  weekdays: [1, 2, 3, 4, 5],
  timeZone: 'Asia/Seoul',
  instruction: '이번 주 글 진행을 확인해 주세요',
};

const put = (agent: Json, body: Json, as = owner, headers: Record<string, string> = {}) =>
  api.request('PUT', `/api/agents/${agent.id}/heartbeat`, as, body, headers);

async function heartbeatOf(agent: Json): Promise<Json | null> {
  const { agents } = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
  return (agents.find((a) => a.id === agent.id)?.heartbeat as Json | null) ?? null;
}

/** 다음 시각을 지난 때로 돌려 일꾼이 바로 깨우게 한다 */
async function makeDue(agent: Json, minutesAgo = 1): Promise<void> {
  await db.sql`
    UPDATE task.heartbeats SET next_run_at = now() - make_interval(mins => ${minutesAgo})
    WHERE agent_id = ${String(agent.id)}`;
}

async function heartbeatTasks(agent: Json): Promise<Json[]> {
  return [
    ...(await db.sql`
      SELECT id, status, title, instruction, goal_id, request_id FROM task.tasks
      WHERE agent_id = ${String(agent.id)} AND request_id LIKE 'heartbeat:%' ORDER BY id`),
  ];
}

describe('하트비트 (/api/agents/:id/heartbeat)', () => {
  test('방문자와 write 기기는 정하지 못한다 (403)', async () => {
    const agent = await newAgent();
    for (const headers of [{}, writer]) {
      const res = await put(agent, { ...DAILY, version: 0 }, TestUser.visitor, headers);
      assert.equal(res.status, 403, res.text);
    }
    assert.equal(await heartbeatOf(agent), null);
  });

  test('주인이 정하면 다음 시각이 생기고 에이전트 목록에 실린다. version으로 늦은 쓰기를 막는다', async () => {
    const agent = await newAgent();
    assert.equal(await heartbeatOf(agent), null, '정한 적이 없으면 null');
    const made = ok(await put(agent, { ...DAILY, version: 0 }));
    assert.equal(made.enabled, true);
    assert.equal(made.atTime, '09:30');
    assert.deepEqual(made.weekdays, [1, 2, 3, 4, 5]);
    assert.ok(new Date(String(made.nextRunAt)).getTime() > Date.now());
    assert.deepEqual(await heartbeatOf(agent), made);

    assert.equal((await put(agent, { ...DAILY, version: 0 })).status, 409, '이미 있다');
    const hourly = ok(
      await put(agent, { ...DAILY, mode: 'hourly', everyHours: 6, version: made.version }),
    );
    assert.equal(hourly.atTime, null);
    assert.equal(hourly.everyHours, 6);
    assert.equal((await put(agent, { ...DAILY, version: made.version })).status, 409, '늦은 쓰기');

    const off = ok(await put(agent, { ...DAILY, enabled: false, version: hourly.version }));
    assert.equal(off.nextRunAt, null, '끄면 다음 시각이 없다');
  });

  test('모양이 틀리면 400, 뜻이 틀리면 422, 없는 에이전트는 404', async () => {
    const agent = await newAgent();
    const shape = await put(agent, { ...DAILY, atTime: '9시', version: 0 });
    assert.equal(shape.status, 400, shape.text);
    assert.ok((shape.json().fields as Json).atTime);
    assert.equal((await put(agent, { ...DAILY, timeZone: 'Mars/Base', version: 0 })).status, 422);
    assert.equal((await put(agent, { ...DAILY, weekdays: [], version: 0 })).status, 422);
    assert.equal((await put(agent, { ...DAILY, mode: 'hourly', version: 0 })).status, 422);
    const missing = await put({ id: randomUUID() }, { ...DAILY, version: 0 });
    assert.equal(missing.status, 404, missing.text);

    const goal = ok(
      await api.request('POST', '/api/goals', owner, { requestId: randomUUID(), title: '닫힘' }),
      201,
    );
    ok(
      await api.request('POST', `/api/goals/${goal.id}/status`, owner, {
        status: 'dropped',
        version: goal.version,
      }),
    );
    assert.equal(
      (await put(agent, { ...DAILY, goalId: goal.id, version: 0 })).status,
      422,
      '닫힌 목표',
    );
  });

  test('때가 되면 일꾼이 작업 하나를 만들고 다음 시각으로 넘긴다. 두 번 돌아도 하나', async () => {
    const goal = ok(
      await api.request('POST', '/api/goals', owner, { requestId: randomUUID(), title: '블로그' }),
      201,
    );
    const agent = await newAgent();
    ok(await put(agent, { ...DAILY, goalId: goal.id, version: 0 }));
    await makeDue(agent);

    await Promise.all([job.run(), job.run()]);
    const tasks = await heartbeatTasks(agent);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, 'queued');
    assert.equal(tasks[0]?.instruction, DAILY.instruction);
    assert.equal(tasks[0]?.goal_id, goal.id);
    assert.match(String(tasks[0]?.title), /^정기 확인 \(/);
    assert.match(String(tasks[0]?.request_id), new RegExp(`^heartbeat:${agent.id}:`));
    const after = await heartbeatOf(agent);
    assert.ok(new Date(String(after?.nextRunAt)).getTime() > Date.now(), '다음 시각으로 넘어감');
    assert.equal(typeof after?.lastRunAt, 'string');

    await job.run();
    assert.equal((await heartbeatTasks(agent)).length, 1, '다음 시각 전에는 더 만들지 않는다');
  });

  test('앞 하트비트 작업이 끝나지 않았거나 에이전트가 멈췄으면 이번은 건너뛴다', async () => {
    const agent = await newAgent();
    ok(await put(agent, { ...DAILY, version: 0 }));
    await makeDue(agent, 3);
    await job.run();
    assert.equal((await heartbeatTasks(agent)).length, 1);

    await makeDue(agent, 2);
    await job.run();
    assert.equal((await heartbeatTasks(agent)).length, 1, '앞 작업이 아직 대기 중');

    const [first] = await heartbeatTasks(agent);
    const { version } = ok(await api.get(`/api/tasks/${first?.id}`, owner));
    ok(await api.request('POST', `/api/tasks/${first?.id}/cancel`, owner, { version }));
    const paused = ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, { version: agent.version }),
    );
    await makeDue(agent, 1);
    await job.run();
    assert.equal((await heartbeatTasks(agent)).length, 1, '멈춘 에이전트');

    ok(
      await api.request('POST', `/api/agents/${agent.id}/resume`, owner, {
        version: paused.version,
      }),
    );
    await makeDue(agent, 1);
    await job.run();
    assert.equal((await heartbeatTasks(agent)).length, 2, '다시 움직이면 깨운다');
  });
});
