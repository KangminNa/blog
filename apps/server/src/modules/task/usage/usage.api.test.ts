import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { ChangeStream, Database } from '../../platform';

// 사용량과 쉬기. 러너는 MCP로, 주인은 REST로 들어온다.
// 실행 기록은 고칠 수 없어서 지난 사용량은 과거 시각으로 새 기록을 넣어 만든다.

type Json = Record<string, unknown>;
type Usage = { agents: Json[]; plan: Json[] };

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한을 준 기기 (러너) */
let runner: string;
/** 기본 권한만 있는 기기 */
let laptop: string;

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(name: string, args: Json = {}): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(runner, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

const newAgent = async (more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      tool: 'claude',
      ...more,
    }),
    201,
  );

const newTask = async (agent: Json | null, more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent?.id ?? null,
      instruction: '글을 써 주세요',
      ...more,
    }),
    201,
  );

const getTask = async (id: unknown): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));
const getUsage = async (): Promise<Usage> => ok(await api.get('/api/usage', owner)) as Usage;

const usageOf = async (agent: Json): Promise<Json> => {
  const row = (await getUsage()).agents.find((a) => a.id === agent.id);
  assert.ok(row);
  return row;
};

const windowOf = async (toolName: string, window: string): Promise<Json | undefined> =>
  (await getUsage()).plan.find((p) => p.tool === toolName && p.window === window);

/** 러너가 빌린 작업들의 id */
async function lease(limit = 1): Promise<string[]> {
  const { ok: done, body } = await tool('next_jobs', { limit });
  assert.equal(done, true, JSON.stringify(body));
  return (body.jobs as { task: { id: string } }[]).map((job) => job.task.id);
}

const report = (taskId: unknown, more: Json = {}) =>
  tool('report_progress', { task_id: taskId, events: [], ...more });

const planRow = (window: string, percent: number, resets_at = inMinutes(60)) => ({
  window,
  percent,
  resets_at,
  status: 'allowed',
});

/** 작업을 하나 빌려 달게 하고, 그 작업으로 구독 사용률을 보고한다 */
async function reportPlan(agent: Json, ...rows: Json[]): Promise<Json> {
  const task = await newTask(agent);
  assert.deepEqual(await lease(), [task.id]);
  const res = await report(task.id, { plan_usage: rows });
  assert.equal(res.ok, true, JSON.stringify(res.body));
  ok(await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, await versionOf(task)));
  return task;
}

const versionOf = async (task: Json): Promise<Json> => ({
  version: (await getTask(task.id)).version,
});

/** 에이전트가 ago(Postgres interval) 전에 토큰을 썼다는 기록을 남긴다 */
async function spent(agent: Json, tokens: number, ago: string): Promise<void> {
  const [row] = await db.sql`
    INSERT INTO task.tasks (space_id, agent_id, kind, title, status)
    SELECT space_id, id, 'general', '지난 일', 'done' FROM task.agents WHERE id = ${String(agent.id)}
    RETURNING id`;
  await db.sql`
    INSERT INTO task.task_events (task_id, at, kind, tokens)
    VALUES (${String(row?.id)}, now() - ${ago}::interval, 'read', ${tokens})`;
}

/** 이 테스트의 에이전트와 일만 보이게 앞 테스트가 남긴 것을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.agents SET status = 'paused' WHERE status = 'active'`;
  await db.sql`DELETE FROM task.plan_usage`;
});

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
  runner = await api.connectDevice(owner, 'usage-runner');
  laptop = await api.connectDevice(owner, 'usage-laptop');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'usage-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'run'],
      version: device?.version,
    }),
  );
});

after(async () => {
  await api.close();
});

describe('GET /api/usage', () => {
  test('방문자와 기기는 볼 수 없고 주인은 본다', async () => {
    assert.equal((await api.get('/api/usage')).status, 403);
    const headers = { authorization: `Bearer ${laptop}` };
    const res = await api.request('GET', '/api/usage', TestUser.visitor, undefined, headers);
    assert.equal(res.status, 403);
    assert.equal(res.json().scope, 'owner');

    const agent = await newAgent({ monthlyLimit: 1000, fiveHourLimit: 500, planStopPercent: 80 });
    assert.deepEqual(await usageOf(agent), {
      id: agent.id,
      fiveHourTokens: 0,
      monthTokens: 0,
      fiveHourLimit: 500,
      monthlyLimit: 1000,
      planStopPercent: 80,
      holding: false,
    });
  });

  test('5시간은 굴러가는 합이고 이번 달은 usedThisMonth와 같다', async () => {
    const agent = await newAgent();
    const task = await newTask(agent);
    await lease();
    await report(task.id, {
      events: [
        { kind: 'read', tokens: 30 },
        { kind: 'write', tokens: 12 },
      ],
    });
    await spent(agent, 7, '4 hours 59 minutes');
    await spent(agent, 100, '5 hours 1 minute');

    const row = await usageOf(agent);
    assert.equal(row.fiveHourTokens, 49);
    const { agents } = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
    const used = agents.find((a) => a.id === agent.id)?.usedThisMonth;
    const [start] = await db.sql`
      SELECT now() - interval '5 hours 1 minute' >= date_trunc('month', now()) AS same_month`;
    assert.equal(used, start?.same_month ? 149 : 49);
    assert.equal(row.monthTokens, used);
  });

  test('다른 에이전트의 토큰은 세지 않는다', async () => {
    const mine = await newAgent();
    await spent(await newAgent(), 50, '1 hour');
    assert.equal((await usageOf(mine)).fiveHourTokens, 0);
  });

  test('본 적 없는 창은 확인 전이다', async () => {
    await newAgent();
    assert.deepEqual(await windowOf('claude', 'five_hour'), {
      tool: 'claude',
      window: 'five_hour',
      percent: null,
      resetsAt: null,
      seenAt: null,
    });
    assert.equal((await windowOf('claude', 'seven_day'))?.percent, null);
    assert.equal(await windowOf('codex', 'five_hour'), undefined);
  });
});

describe('구독 사용률 보고', () => {
  test('진행 보고가 창을 남긴다. 도구는 작업의 에이전트가 정한다', async () => {
    const agent = await newAgent({ tool: 'codex' });
    const resetsAt = inMinutes(30);
    await reportPlan(agent, planRow('five_hour', 72, resetsAt), planRow('seven_day', 19));

    const five = await windowOf('codex', 'five_hour');
    assert.equal(five?.percent, 72);
    assert.equal(five?.resetsAt, resetsAt);
    assert.ok(five?.seenAt);
    assert.equal((await windowOf('codex', 'seven_day'))?.percent, 19);
  });

  test('다시 보면 새 값으로 바뀐다', async () => {
    const agent = await newAgent();
    await reportPlan(agent, planRow('five_hour', 72));
    await reportPlan(agent, planRow('five_hour', 80));
    assert.equal((await windowOf('claude', 'five_hour'))?.percent, 80);
    const rows = await db.sql`SELECT 1 FROM task.plan_usage WHERE period = 'five_hour'`;
    assert.equal(rows.length, 1);
  });

  test('기록이 없는 빈 보고에도 실린다', async () => {
    const task = await newTask(await newAgent());
    await lease();
    const res = await report(task.id, { events: [], plan_usage: [planRow('five_hour', 5)] });
    assert.equal(res.ok, true);
    assert.equal((await windowOf('claude', 'five_hour'))?.percent, 5);
  });

  test('모르는 창은 넘어가고, 같은 창이 또 오면 마지막 값이다', async () => {
    const agent = await newAgent();
    await reportPlan(
      agent,
      planRow('one_hour', 50),
      planRow('five_hour', 10),
      planRow('five_hour', 20),
    );
    assert.equal((await windowOf('claude', 'five_hour'))?.percent, 20);
    const rows = await db.sql`SELECT period FROM task.plan_usage`;
    assert.deepEqual(
      rows.map((r) => r.period),
      ['five_hour'],
    );
  });

  test('초과 사용은 100을 넘어도 받고, 모르는 창만 오면 아무것도 남지 않는다', async () => {
    const agent = await newAgent();
    await reportPlan(agent, planRow('five_hour', 1000));
    assert.equal((await windowOf('claude', 'five_hour'))?.percent, 1000);
    await db.sql`DELETE FROM task.plan_usage`;
    await reportPlan(agent, planRow('one_hour', 10));
    assert.equal((await db.sql`SELECT 1 FROM task.plan_usage`).length, 0);
  });

  test('상태는 없어도 된다', async () => {
    const agent = await newAgent();
    await reportPlan(agent, { window: 'five_hour', percent: 5, resets_at: inMinutes(5) });
    const [row] = await db.sql`SELECT status FROM task.plan_usage`;
    assert.equal(row?.status, null);
  });

  test('범위를 벗어난 값은 거절하고 보고 전체가 남지 않는다', async () => {
    const task = await newTask(await newAgent());
    await lease();
    const bad: Json[] = [
      planRow('five_hour', -1),
      planRow('five_hour', 1001),
      planRow('five_hour', 72.5),
      { window: 'five_hour', percent: 10 },
      { window: 'five_hour', percent: 10, resets_at: '내일' },
      { percent: 10, resets_at: inMinutes(5) },
      { ...planRow('five_hour', 10), status: 'wat' },
    ];
    for (const row of bad) {
      const res = await report(task.id, {
        events: [{ kind: 'read', body: '남으면 안 되는 기록' }],
        plan_usage: [row],
      });
      assert.equal(res.ok, false, JSON.stringify(row));
    }
    assert.equal((await report(task.id, { plan_usage: 'many' })).ok, false);
    assert.deepEqual((await getTask(task.id)).events, []);
    assert.equal((await db.sql`SELECT 1 FROM task.plan_usage`).length, 0);
  });

  test('같은 request_id의 보고는 다시 저장하지 않는다', async () => {
    const task = await newTask(await newAgent());
    await lease();
    const request_id = randomUUID();
    const first = { request_id, events: [{ kind: 'read', tokens: 1 }] };
    await report(task.id, { ...first, plan_usage: [planRow('five_hour', 10)] });
    await report(task.id, { ...first, plan_usage: [planRow('five_hour', 90)] });
    assert.equal((await windowOf('claude', 'five_hour'))?.percent, 10);
  });

  test('작업의 version을 올리지 않는다', async () => {
    const task = await newTask(await newAgent());
    await lease();
    const before = await getTask(task.id);
    await report(task.id, { plan_usage: [planRow('five_hour', 10)] });
    assert.equal((await getTask(task.id)).version, before.version);
  });

  test('콘솔에 변경 신호를 보낸다', async () => {
    const task = await newTask(await newAgent());
    await lease();
    const signal = api
      .service(ChangeStream)
      .wait((s) => s.topic === 'task.usage.changed' && s.id === 'claude', 5_000);
    await sleep(100);
    await report(task.id, { plan_usage: [planRow('five_hour', 10)] });
    assert.equal(await signal, true);
  });
});

describe('쉬기', () => {
  test('5시간 한도에 닿으면 일을 빌려주지 않고, 창이 지나면 저절로 다시 빌려준다', async () => {
    const agent = await newAgent({ fiveHourLimit: 100 });
    // 곧 5시간을 벗어날 기록
    await spent(agent, 100, '4 hours 59 minutes 56 seconds');
    const task = await newTask(agent);
    const before = await getTask(task.id);

    assert.deepEqual(await lease(), []);

    const after = await getTask(task.id);
    assert.equal(after.status, 'queued');
    assert.equal(after.attempts, 0);
    assert.equal(after.version, before.version);
    assert.equal((await usageOf(agent)).holding, true);
    const { agents } = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
    assert.equal(agents.find((a) => a.id === agent.id)?.status, 'active');
    const { approvals } = ok(await api.get('/api/approvals?status=pending', owner)) as {
      approvals: Json[];
    };
    assert.equal(
      approvals.some((a) => a.agentId === agent.id),
      false,
    );

    await sleep(4_500);
    assert.equal((await usageOf(agent)).holding, false);
    assert.deepEqual(await lease(), [task.id]);
  });

  test('구독 사용률은 유효한 창 중 가장 높은 값으로 따진다', async () => {
    await reportPlan(await newAgent(), planRow('five_hour', 10), planRow('seven_day', 90));
    const agent = await newAgent({ planStopPercent: 50 });
    const task = await newTask(agent);
    assert.deepEqual(await lease(), []);
    assert.equal((await usageOf(agent)).holding, true);

    ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        version: agent.version,
        planStopPercent: 95,
      }),
    );
    assert.equal((await usageOf(agent)).holding, false);
    assert.deepEqual(await lease(), [task.id]);
  });

  test('초기화 시각이 지난 창은 쉬는 데 쓰지 않고 확인 전으로 보인다', async () => {
    await reportPlan(await newAgent(), planRow('five_hour', 99, inMinutes(-1)));
    const agent = await newAgent({ planStopPercent: 50 });
    const task = await newTask(agent);

    assert.equal((await usageOf(agent)).holding, false);
    const five = await windowOf('claude', 'five_hour');
    assert.equal(five?.percent, null);
    assert.equal(five?.resetsAt, null);
    assert.ok(five?.seenAt);
    assert.deepEqual(await lease(), [task.id]);
  });

  test('구독 창이 초기화되면 저절로 다시 빌려준다', async () => {
    await reportPlan(await newAgent(), planRow('five_hour', 99, inMinutes(4 / 60)));
    const agent = await newAgent({ planStopPercent: 50 });
    const task = await newTask(agent);

    assert.deepEqual(await lease(), []);

    await sleep(4_500);
    assert.deepEqual(await lease(), [task.id]);
  });

  test('구독 사용률이 확인 전이어도 토큰 한도는 쉰다', async () => {
    const agent = await newAgent({ fiveHourLimit: 10, planStopPercent: 50 });
    await spent(agent, 10, '1 hour');
    await newTask(agent);
    assert.equal((await windowOf('claude', 'five_hour'))?.percent, null);
    assert.deepEqual(await lease(), []);
  });

  test('다른 도구의 구독 사용률은 보지 않는다', async () => {
    await reportPlan(await newAgent({ tool: 'codex' }), planRow('five_hour', 99));
    const agent = await newAgent({ planStopPercent: 50 });
    const task = await newTask(agent);
    assert.equal((await usageOf(agent)).holding, false);
    assert.deepEqual(await lease(), [task.id]);
  });

  test('달리는 작업은 한도에 닿아도 끝까지 간다. 보고는 paused를 돌려주지 않는다', async () => {
    const agent = await newAgent({ fiveHourLimit: 100, planStopPercent: 50 });
    const task = await newTask(agent);
    assert.deepEqual(await lease(), [task.id]);

    const { body } = await report(task.id, {
      events: [{ kind: 'read', tokens: 500 }],
      plan_usage: [planRow('five_hour', 99)],
    });

    assert.equal(body.paused, false);
    assert.equal(body.cancelled, false);
    assert.equal(body.status, 'running');
    assert.equal((await usageOf(agent)).holding, true);

    const next = await report(task.id);
    assert.equal(next.body.paused, false);
    const done = await tool('submit_result', {
      task_id: task.id,
      request_id: randomUUID(),
      status: 'done',
    });
    assert.equal(done.body.status, 'done');
  });

  test('쉬는 에이전트의 일은 뒤의 일을 막지 않는다', async () => {
    const held = await newAgent({ fiveHourLimit: 10 });
    await spent(held, 10, '1 hour');
    const first = await newTask(held, { priority: 10 });
    const second = await newTask(await newAgent());

    assert.deepEqual(await lease(5), [second.id]);
    assert.equal((await getTask(first.id)).status, 'queued');
  });

  test('담당 없는 일은 쉬지 않는 첫 에이전트가 맡는다', async () => {
    const held = await newAgent({ fiveHourLimit: 10 });
    await spent(held, 10, '1 hour');
    const free = await newAgent();
    const task = await newTask(null);

    assert.deepEqual(await lease(), [task.id]);
    assert.equal((await getTask(task.id)).agentId, free.id);
  });

  test('모두 쉬면 담당 없는 일도 대기열에 남는다', async () => {
    const held = await newAgent({ fiveHourLimit: 10 });
    await spent(held, 10, '1 hour');
    const task = await newTask(null);

    assert.deepEqual(await lease(), []);

    const after = await getTask(task.id);
    assert.equal(after.status, 'queued');
    assert.equal(after.agentId, null);
  });

  test('한 달 한도는 그대로 멈추고 결재를 올린다', async () => {
    const agent = await newAgent({ monthlyLimit: 100, fiveHourLimit: 1000 });
    const task = await newTask(agent);
    await lease();

    const { body } = await report(task.id, { events: [{ kind: 'read', tokens: 101 }] });

    assert.equal(body.paused, true);
    const { approvals } = ok(await api.get('/api/approvals?status=pending', owner)) as {
      approvals: Json[];
    };
    const raises = approvals.filter(
      (a) => a.action === 'task.agent.raise_limit' && a.agentId === agent.id,
    );
    assert.equal(raises.length, 1);
    assert.equal((await usageOf(agent)).holding, false);
  });
});

describe('에이전트의 한도 입력', () => {
  test('만들 때 받고, 고칠 때 바꾸고, 보내지 않으면 그대로, null이면 없앤다', async () => {
    const agent = await newAgent({ fiveHourLimit: 500, planStopPercent: 80 });
    assert.equal(agent.fiveHourLimit, 500);
    assert.equal(agent.planStopPercent, 80);

    const renamed = ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        version: agent.version,
        name: '새 이름',
      }),
    );
    assert.equal(renamed.fiveHourLimit, 500);
    assert.equal(renamed.planStopPercent, 80);

    const changed = ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        version: renamed.version,
        fiveHourLimit: 900,
        planStopPercent: null,
      }),
    );
    assert.equal(changed.fiveHourLimit, 900);
    assert.equal(changed.planStopPercent, null);

    const { agents } = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
    const row = agents.find((a) => a.id === agent.id);
    assert.equal(row?.fiveHourLimit, 900);
    assert.equal(row?.planStopPercent, null);
  });

  test('범위를 벗어나면 400', async () => {
    const agent = await newAgent();
    for (const bad of [
      { fiveHourLimit: 0 },
      { fiveHourLimit: -1 },
      { fiveHourLimit: 1.5 },
      { planStopPercent: 0 },
      { planStopPercent: 101 },
    ]) {
      const patched = await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        version: agent.version,
        ...bad,
      });
      assert.equal(patched.status, 400, JSON.stringify(bad));
      const created = await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: '틀린 값',
        tool: 'claude',
        ...bad,
      });
      assert.equal(created.status, 400, JSON.stringify(bad));
    }
  });

  test('버전이 어긋나면 409', async () => {
    const agent = await newAgent();
    ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        version: agent.version,
        fiveHourLimit: 10,
      }),
    );
    const stale = await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
      version: agent.version,
      fiveHourLimit: 20,
    });
    assert.equal(stale.status, 409);
  });

  test('방문자는 한도를 바꿀 수 없다', async () => {
    const agent = await newAgent();
    const res = await api.request('PATCH', `/api/agents/${agent.id}`, TestUser.visitor, {
      version: agent.version,
      fiveHourLimit: 10,
    });
    assert.equal(res.status, 403);
  });
});
