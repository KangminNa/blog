import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../testing/api-client';
import {
  BaseHandler,
  ChangeStream,
  CoreWorkers,
  Database,
  DomainEvent,
  Outbox,
  OutboxWorker,
} from '../platform';

// 작업과 결재. 러너는 MCP로, 주인은 REST로 들어온다. 이벤트는 outbox와 일꾼을 실제로 거친다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let worker: OutboxWorker;
/** run 권한을 준 기기 (러너) */
let runner: string;
/** 기본 권한만 있는 기기 */
let laptop: string;

/** 도구 하나를 부른다. AI가 받는 결과(성공이면 structuredContent, 실패면 오류 JSON) */
async function tool(
  token: string,
  name: string,
  args: Json = {},
): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
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

async function toolNames(token: string): Promise<string[]> {
  const res = await api.mcp(token, 'tools/list');
  assert.equal(res.status, 200, res.text);
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function newAgent(more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions: ['blog.post.publish'],
      ...more,
    }),
    201,
  );
}

async function newTask(agent: Json | null, more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent?.id ?? null,
      kind: 'draft_post',
      title: '초안 쓰기',
      instruction: '세션으로 글을 써 주세요',
      ...more,
    }),
    201,
  );
}

const getTask = async (id: unknown): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));

const getApproval = async (id: unknown): Promise<Json> =>
  ok(await api.get(`/api/approvals/${id}`, owner));

const decide = (id: unknown, version: unknown, decision: string, note?: string) =>
  api.request('POST', `/api/approvals/${id}/decide`, owner, { version, decision, note });

/** 러너가 일을 하나 빌린다 */
async function take(): Promise<{
  task: Json;
  instruction: string;
  target: Json | null;
  skill: string | null;
  revision_note: string | null;
  agent: Json;
  run_token: string;
}> {
  const { ok: done, body } = await tool(runner, 'next_jobs');
  assert.equal(done, true, JSON.stringify(body));
  const jobs = body.jobs as Awaited<ReturnType<typeof take>>[];
  assert.equal(jobs.length, 1, JSON.stringify(body));
  return jobs[0] as Awaited<ReturnType<typeof take>>;
}

function askApproval(token: string, more: Json = {}) {
  return tool(token, 'request_approval', {
    request_id: randomUUID(),
    action: 'blog.post.publish',
    target_kind: 'post',
    target_id: randomUUID(),
    target_version: 3,
    note: '공개해 주세요',
    ...more,
  });
}

/** 일꾼을 outbox가 빌 때까지 돌린다 */
async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

/** 다른 모듈이 보낸 것처럼 이벤트를 outbox에 남긴다 */
function publish(event: DomainEvent): Promise<void> {
  return db.transaction((tx) => new Outbox(tx).publish([event]));
}

/** 앞 테스트가 닫은 스트림까지 서버가 정리하기를 기다린다. 안 비면 정리가 고장 난 것이다 */
async function noReceivers(): Promise<ReadonlySet<unknown>> {
  const { receivers } = api.service(ChangeStream) as unknown as { receivers: Set<unknown> };
  for (let i = 0; i < 100 && receivers.size > 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(receivers.size, 0);
  return receivers;
}

async function spaceId(): Promise<string> {
  const [row] = await db.sql`SELECT space_id FROM task.agents LIMIT 1`;
  return String(row?.space_id);
}

/** 이 테스트의 일만 보이게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
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
  runner = await api.connectDevice(owner, 'task-runner');
  laptop = await api.connectDevice(owner, 'task-laptop');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'task-runner');
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

describe('누가 쓸 수 있나', () => {
  test('방문자는 작업·결재·에이전트를 볼 수 없다', async () => {
    for (const path of ['/api/tasks', '/api/approvals', '/api/agents', '/api/stream']) {
      assert.equal((await api.get(path)).status, 403, path);
    }
    const res = await api.request('POST', '/api/tasks', TestUser.visitor, {});
    assert.equal(res.status, 400);
  });

  test('기기는 write 권한이 있어도 주인의 일을 할 수 없다', async () => {
    const headers = { authorization: `Bearer ${laptop}` };
    const res = await api.request('GET', '/api/agents', TestUser.visitor, undefined, headers);
    assert.equal(res.status, 403);
    assert.equal(res.json().scope, 'owner');
  });

  test('run 권한이 없는 기기에게는 러너 도구가 보이지 않는다', async () => {
    const names = await toolNames(laptop);
    assert.equal(names.includes('next_jobs'), false);
    assert.equal(names.includes('request_approval'), false);
    assert.equal(names.includes('save_session'), true);
    assert.equal((await tool(laptop, 'next_jobs')).body.scope, 'run');
  });

  test('기기는 작업 토큰 없이 결재를 올릴 수 없다', async () => {
    const names = await toolNames(runner);
    for (const name of ['next_jobs', 'report_progress', 'submit_result', 'release_job'])
      assert.equal(names.includes(name), true, name);
    assert.equal(names.includes('request_approval'), false);
    assert.equal((await askApproval(runner)).body.scope, 'agent');
  });

  test('에이전트에게 러너의 권한을 줄 수 없다', async () => {
    const res = await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '러너가 되려는 에이전트',
      tool: 'claude',
      scopes: ['run'],
    });
    assert.equal(res.status, 422);
  });
});

describe('가짜 러너', () => {
  test('에이전트 → 작업 → 빌리기 → 진행 → 결재 → 결과 이벤트로 끝', async () => {
    const granted: DomainEvent[] = [];
    class GrantProbe extends BaseHandler {
      async handle(event: DomainEvent): Promise<void> {
        granted.push(event);
      }
    }
    api.service(CoreWorkers).on('task.approval.granted', new GrantProbe());

    // task는 무엇을 실행하는지 모른다: 실행하는 모듈이 없는 동작으로 가짜 결과까지 이어 본다 (글 공개는 blog의 publish.api.test)
    const agent = await newAgent({ approvalActions: ['blog.post.publish', 'sns.post.send'] });
    const postId = randomUUID();
    const task = await newTask(agent, { targetKind: 'post', targetId: postId, baseVersion: 3 });
    assert.equal(task.status, 'queued');

    const job = await take();
    assert.equal(job.task.id, task.id);
    assert.equal(job.instruction, '세션으로 글을 써 주세요');
    assert.equal(job.skill, 'cairn-write');
    assert.deepEqual(job.target, { kind: 'post', id: postId, version: 3 });
    assert.equal(job.agent.tool, 'claude');
    assert.match(job.run_token, /^cairn_run_/);
    assert.equal((await getTask(task.id)).status, 'running');

    const progress = await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [{ kind: 'write', body: '초안을 썼어요', tokens: 40 }],
    });
    assert.deepEqual(
      { ...progress.body, lease_until: undefined },
      { status: 'running', cancelled: false, paused: false, lease_until: undefined },
    );

    const asked = await askApproval(job.run_token, { action: 'sns.post.send', target_id: postId });
    assert.equal(asked.ok, true, JSON.stringify(asked.body));
    assert.equal(asked.body.status, 'pending');
    assert.equal((await getTask(task.id)).status, 'waiting');

    const inbox = ok(await api.get('/api/approvals?status=pending', owner)) as {
      approvals: Json[];
    };
    const approval = inbox.approvals.find((a) => a.id === asked.body.approval_id);
    assert.deepEqual(approval?.target, { kind: 'post', id: postId, version: 3 });
    assert.equal(approval?.action, 'sns.post.send');
    assert.equal(approval?.taskId, task.id);

    const decided = ok(await decide(approval?.id, approval?.version, 'approve'));
    assert.equal(decided.status, 'approved');
    assert.equal((await getTask(task.id)).status, 'running');

    // 승인은 outbox를 거쳐 대상 모듈에게 간다
    await drain();
    const event = granted.find((e) => e.data.approvalId === approval?.id);
    assert.equal(event?.data.action, 'sns.post.send');
    assert.equal(event?.data.targetKind, 'post');
    assert.equal(event?.data.targetId, postId);
    assert.equal(event?.data.targetVersion, 3);
    assert.equal(typeof event?.data.decidedBy, 'string');
    assert.equal(event?.data.taskId, task.id);

    // 받는 모듈이 없으니 결과가 오기 전까지 그대로다. 가짜 결과 이벤트로 끝낸다
    assert.equal((await getTask(task.id)).status, 'running');
    await publish(
      new DomainEvent('blog.post.published', 1, await spaceId(), {
        postId,
        approvalId: approval?.id,
        outcome: 'done',
      }),
    );
    await drain();
    const finished = await getTask(task.id);
    assert.equal(finished.status, 'done');
    assert.equal(typeof finished.finishedAt, 'string');
    const kinds = (finished.events as Json[]).map((e) => e.kind);
    assert.deepEqual(kinds, ['write', 'write', 'result']);

    // 같은 결과가 또 와도 그대로
    await publish(
      new DomainEvent('blog.post.published', 1, await spaceId(), {
        approvalId: approval?.id,
        outcome: 'failed',
        error: '늦게 온 실패',
      }),
    );
    await drain();
    assert.equal((await getTask(task.id)).status, 'done');
  });

  test('실패 결과 이벤트는 작업을 실패로 끝낸다', async () => {
    const agent = await newAgent({ approvalActions: ['blog.post.publish', 'sns.post.send'] });
    const task = await newTask(agent);
    const job = await take();
    const asked = await askApproval(job.run_token, { action: 'sns.post.send' });
    const approval = await getApproval(asked.body.approval_id);
    ok(await decide(approval.id, approval.version, 'approve'));
    await publish(
      new DomainEvent('blog.post.publish_failed', 1, await spaceId(), {
        approvalId: approval.id,
        outcome: 'failed',
        error: '판이 바뀌었어요',
      }),
    );
    await drain();
    const finished = await getTask(task.id);
    assert.equal(finished.status, 'failed');
    assert.deepEqual(finished.result, { error: '판이 바뀌었어요' });
  });

  test('고쳐 달라고 하면 말과 함께 러너에게 돌아간다', async () => {
    const task = await newTask(await newAgent());
    const first = await take();
    assert.equal(first.revision_note, null);
    const asked = await askApproval(first.run_token);
    const approval = await getApproval(asked.body.approval_id);

    const empty = await decide(approval.id, approval.version, 'revise');
    assert.equal(empty.status, 422);

    ok(await decide(approval.id, approval.version, 'revise', '제목을 바꿔 주세요'));
    assert.equal((await getTask(task.id)).status, 'queued');

    // 앞의 작업 토큰은 끝나고, 새 임대에 새 토큰이 온다
    assert.equal((await api.mcp(first.run_token, 'tools/list')).status, 401);
    const second = await take();
    assert.equal(second.task.id, task.id);
    assert.equal(second.revision_note, '제목을 바꿔 주세요');
    assert.equal((await askApproval(second.run_token)).ok, true);
  });

  test('거절하면 작업이 멈춘다', async () => {
    const task = await newTask(await newAgent());
    const job = await take();
    const asked = await askApproval(job.run_token);
    const approval = await getApproval(asked.body.approval_id);
    ok(await decide(approval.id, approval.version, 'reject', '안 올려요'));
    assert.equal((await getTask(task.id)).status, 'cancelled');
    assert.equal((await getApproval(approval.id)).note, '안 올려요');
  });

  test('맡기지 않은 동작은 결재를 올릴 수 없다', async () => {
    await newTask(await newAgent());
    const job = await take();
    const asked = await askApproval(job.run_token, { action: 'sns.post.send' });
    assert.equal(asked.ok, false);
    assert.equal(asked.body.code, 'forbidden');
  });

  test('진행 보고는 기록을 모아 받고 토큰을 더한다. 비어 있으면 임대만 늘린다', async () => {
    const agent = await newAgent({ monthlyLimit: 100 });
    const task = await newTask(agent);
    await take();
    const report = await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [
        { kind: 'read', body: '세션 읽기', tokens: 60 },
        { kind: 'write', body: '초안 쓰기', tokens: 41 },
      ],
    });
    assert.equal(report.body.paused, true);
    const events = (await getTask(task.id)).events as Json[];
    assert.deepEqual(
      events.map((e) => e.body),
      ['세션 읽기', '초안 쓰기'],
    );

    const empty = await tool(runner, 'report_progress', { task_id: task.id, events: [] });
    assert.equal(empty.ok, true);
    assert.equal(((await getTask(task.id)).events as Json[]).length, 2);
  });

  test('목록의 lastEvent는 내용이 있는 마지막 기록이다', async () => {
    const task = await newTask(await newAgent());
    await take();
    await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [{ kind: 'read', body: '세션 읽기' }, { kind: 'read' }],
    });
    const page = ok(await api.get('/api/tasks?status=running', owner)) as { tasks: Json[] };
    assert.equal(page.tasks.find((t) => t.id === task.id)?.lastEvent, '세션 읽기');
    assert.equal((await getTask(task.id)).lastEvent, null);
  });

  test('처리하지 못한 일은 돌려줄 수 있다', async () => {
    const task = await newTask(await newAgent());
    await take();
    const released = await tool(runner, 'release_job', { task_id: task.id, reason: '모델 한도' });
    assert.equal(released.body.status, 'queued');
    assert.equal((await take()).task.id, task.id);
    const detail = await getTask(task.id);
    assert.equal(detail.attempts, 1);
    assert.equal((detail.events as Json[]).at(-1)?.body, '돌려줌: 모델 한도');
  });

  test('러너가 끝내면 done, 이유가 있으면 failed', async () => {
    const done = await newTask(await newAgent());
    await take();
    const submitted = await tool(runner, 'submit_result', {
      task_id: done.id,
      request_id: randomUUID(),
      status: 'done',
      result: { summary: '끝' },
    });
    assert.deepEqual(submitted.body, { task_id: done.id, status: 'done' });
    assert.deepEqual((await getTask(done.id)).result, { summary: '끝' });

    const failed = await newTask(await newAgent());
    await take();
    const reported = await tool(runner, 'submit_result', {
      task_id: failed.id,
      request_id: randomUUID(),
      status: 'failed',
      error: '모델이 응답하지 않아요',
    });
    assert.equal(reported.body.status, 'failed');
  });

  test('결과는 done이나 failed만 받는다', async () => {
    const task = await newTask(await newAgent());
    await take();
    const wrong = await tool(runner, 'submit_result', {
      task_id: task.id,
      request_id: randomUUID(),
      status: 'skipped',
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.body.code, 'rule_violation');
    assert.equal((await getTask(task.id)).status, 'running');
  });

  test('결재를 기다리는 작업은 러너가 끝낼 수 없다', async () => {
    const task = await newTask(await newAgent());
    const job = await take();
    await askApproval(job.run_token);
    const submitted = await tool(runner, 'submit_result', {
      task_id: task.id,
      request_id: randomUUID(),
      status: 'done',
    });
    assert.equal(submitted.ok, false);
    assert.equal(submitted.body.code, 'rule_violation');
    const report = await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [{ kind: 'read', body: '마지막 기록' }],
    });
    assert.equal(report.body.status, 'waiting');
  });
});

describe('일 요청 이벤트', () => {
  test('task.task.requested가 outbox를 거쳐 대기 중인 작업이 된다. 두 번 와도 하나', async () => {
    const agent = await newAgent({ scopes: ['read_all', 'tidy'] });
    const requestId = `tidy:${randomUUID()}`;
    const targetId = randomUUID();
    const event = new DomainEvent('task.task.requested', 1, await spaceId(), {
      requestId,
      agentId: agent.id,
      kind: 'tidy_session',
      title: '세션 정리',
      targetKind: 'session',
      targetId,
      baseVersion: 2,
      payload: { sessionId: targetId },
    });
    await publish(event);
    await drain();
    await publish(event);
    await drain();

    const rows = await db.sql`SELECT * FROM task.tasks WHERE request_id = ${requestId}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, 'queued');
    assert.deepEqual(rows[0]?.payload, { sessionId: targetId });

    const job = await take();
    assert.equal(job.task.id, rows[0]?.id);
    assert.equal(job.skill, 'cairn-tidy');
    assert.deepEqual(job.target, { kind: 'session', id: targetId, version: 2 });
  });

  test('담당을 정하지 않은 일은 가장 먼저 만든 움직이는 에이전트가 맡는다', async () => {
    const task = await newTask(null);
    assert.equal(task.agentId, null);
    const job = await take();
    const after = await getTask(task.id);
    assert.equal(after.agentId, job.agent.id);
  });
});

describe('일의 종류와 권한', () => {
  /** tidy 권한을 가진 에이전트를 모두 쉬게 한다. 이 테스트의 에이전트만 일을 맡게 */
  beforeEach(async () => {
    await db.sql`UPDATE task.agents SET status = 'paused' WHERE 'tidy' = ANY(scopes)`;
  });

  const next = async (): Promise<Json[]> => {
    const { ok: done, body } = await tool(runner, 'next_jobs');
    assert.equal(done, true, JSON.stringify(body));
    return body.jobs as Json[];
  };

  test('tidy_session은 tidy가 없는 에이전트에게 가지 않고 대기열에 남아 뒤의 일을 막지 않는다', async () => {
    await newAgent({ scopes: ['read_public', 'write'] });
    const tidy = await newTask(null, { kind: 'tidy_session', instruction: '정리해 주세요' });
    const other = await newTask(null);

    const [job, ...rest] = await next();
    assert.equal(rest.length, 0);
    assert.equal((job?.task as Json | undefined)?.id, other.id, '뒤의 일은 그대로 빌려 간다');
    assert.equal((await getTask(tidy.id)).status, 'queued', '빌렸다가 돌려주지 않는다');
    assert.equal((await getTask(tidy.id)).attempts, 0);
    assert.equal((await next()).length, 0);
  });

  test('담당이 tidy가 없는 에이전트로 정해져 있어도 빌려 주지 않는다', async () => {
    const plain = await newAgent({ scopes: ['read_public'] });
    const task = await newTask(plain, { kind: 'tidy_session', instruction: '정리해 주세요' });
    assert.equal((await next()).length, 0);
    assert.equal((await getTask(task.id)).status, 'queued');
  });

  test('tidy가 있는 에이전트가 생기면 먼저 만든 에이전트를 건너뛰고 그 에이전트가 맡는다', async () => {
    await newAgent({ scopes: ['read_public'] });
    const task = await newTask(null, { kind: 'tidy_session', instruction: '정리해 주세요' });
    assert.equal((await next()).length, 0);

    const able = await newAgent({ scopes: ['read_all', 'tidy'] });
    const [job] = await next();
    assert.equal((job?.task as Json | undefined)?.id, task.id);
    assert.equal((job?.agent as Json | undefined)?.id, able.id);
    assert.equal((await getTask(task.id)).agentId, able.id);
  });

  test('tidy만 있고 전체 읽기가 없으면 맡지 않는다: 세션은 기본이 비공개다', async () => {
    await newAgent({ scopes: ['tidy'] });
    const task = await newTask(null, { kind: 'tidy_session', instruction: '정리해 주세요' });
    assert.equal((await next()).length, 0);
    assert.equal((await getTask(task.id)).status, 'queued');
  });

  test('tidy가 있어도 멈춘 에이전트는 맡지 않는다', async () => {
    const able = await newAgent({ scopes: ['read_all', 'tidy'] });
    ok(await api.request('POST', `/api/agents/${able.id}/pause`, owner, { version: able.version }));
    const task = await newTask(null, { kind: 'tidy_session', instruction: '정리해 주세요' });
    assert.equal((await next()).length, 0);
    assert.equal((await getTask(task.id)).status, 'queued');
  });
});

describe('취소와 임대', () => {
  test('취소는 report_progress의 응답으로 러너에게 닿고 기다리던 결재도 닫는다', async () => {
    const running = await newTask(await newAgent());
    const job = await take();
    const seen = await getTask(running.id);

    // 진행 보고는 version을 올리지 않는다: 보고가 잦아도 주인의 취소가 막히지 않는다
    await tool(runner, 'report_progress', {
      task_id: running.id,
      events: [{ kind: 'read', body: '읽는 중' }],
    });
    ok(
      await api.request('POST', `/api/tasks/${running.id}/cancel`, owner, {
        version: seen.version,
      }),
    );

    const report = await tool(runner, 'report_progress', {
      task_id: running.id,
      events: [{ kind: 'read', body: '아직 도는 중' }],
    });
    assert.equal(report.ok, true);
    assert.equal(report.body.cancelled, true);
    assert.equal(report.body.status, 'cancelled');
    assert.equal((await api.mcp(job.run_token, 'tools/list')).status, 401);

    const late = await tool(runner, 'submit_result', {
      task_id: running.id,
      request_id: randomUUID(),
      status: 'done',
    });
    assert.equal(late.ok, false);

    const waiting = await newTask(await newAgent());
    const second = await take();
    const asked = await askApproval(second.run_token);
    const held = await getTask(waiting.id);
    ok(await api.request('POST', `/api/tasks/${waiting.id}/cancel`, owner, held));
    assert.equal((await getApproval(asked.body.approval_id)).status, 'cancelled');
  });

  test('임대가 끝나면 늦은 제출을 거절하고 일은 다시 대기열로', async () => {
    const task = await newTask(await newAgent());
    const job = await take();
    await db.sql`UPDATE task.tasks SET lease_until = now() - interval '1 minute' WHERE id = ${String(task.id)}`;

    const late = await tool(runner, 'submit_result', {
      task_id: task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { summary: '늦었어요' },
    });
    assert.equal(late.ok, false);
    assert.equal(late.body.code, 'rule_violation');
    const report = await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [],
    });
    assert.equal(report.ok, false);
    assert.equal((await api.mcp(job.run_token, 'tools/list')).status, 401);

    const again = await take();
    assert.equal(again.task.id, task.id);
    const state = await getTask(task.id);
    assert.equal(state.attempts, 2);
    assert.equal(state.result, null);
    assert.equal((state.events as Json[])[0]?.kind, 'error');
  });

  test('임대가 세 번 끝나면 실패로 둔다', async () => {
    const task = await newTask(await newAgent());
    for (let i = 0; i < 3; i++) {
      await take();
      await db.sql`UPDATE task.tasks SET lease_until = now() - interval '1 minute' WHERE id = ${String(task.id)}`;
    }
    const { body } = await tool(runner, 'next_jobs');
    assert.deepEqual(body.jobs, []);
    assert.equal((await getTask(task.id)).status, 'failed');
  });

  test('진행 보고가 임대를 늘린다', async () => {
    const task = await newTask(await newAgent());
    await take();
    await db.sql`UPDATE task.tasks SET lease_until = now() + interval '1 minute' WHERE id = ${String(task.id)}`;
    const before = Date.parse(String((await getTask(task.id)).leaseUntil));
    const { body } = await tool(runner, 'report_progress', { task_id: task.id, events: [] });
    assert.equal(Date.parse(String(body.lease_until)) > before + 10 * 60_000, true);
  });

  test('실행 기록은 고치거나 지울 수 없다', async () => {
    const task = await newTask(await newAgent());
    await take();
    await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [{ kind: 'read', body: '읽는 중' }],
    });
    const id = String(task.id);
    await assert.rejects(
      db.sql`UPDATE task.task_events SET body = '고침' WHERE task_id = ${id}`.then(),
      /append-only/,
    );
    await assert.rejects(
      db.sql`DELETE FROM task.task_events WHERE task_id = ${id}`.then(),
      /append-only/,
    );
  });

  test('다른 러너의 임대에 보고할 수 없다', async () => {
    const task = await newTask(await newAgent());
    await take();
    await db.sql`UPDATE task.tasks SET leased_by = ${randomUUID()} WHERE id = ${String(task.id)}`;
    const report = await tool(runner, 'report_progress', { task_id: task.id, events: [] });
    assert.equal(report.ok, false);
  });
});

describe('중복과 버전', () => {
  test('같은 requestId의 작업은 하나다 (동시에 와도)', async () => {
    const agent = await newAgent();
    const body = {
      requestId: randomUUID(),
      agentId: agent.id,
      kind: 'draft_post',
      title: '두 번 누른 작업',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.request('POST', '/api/tasks', owner, body)),
    );
    const ids = new Set(results.map((r) => ok(r, 201).id));
    assert.equal(ids.size, 1);
    const rows = await db.sql`SELECT id FROM task.tasks WHERE request_id = ${body.requestId}`;
    assert.equal(rows.length, 1);
  });

  test('같은 requestId의 에이전트는 하나다', async () => {
    const requestId = randomUUID();
    const first = await newAgent({ requestId });
    const second = await newAgent({ requestId });
    assert.equal(first.id, second.id);
  });

  test('콘솔은 지시만 보내도 된다. 제목은 첫 줄, 종류는 general', async () => {
    const task = ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        instruction: '\n이번 주 세션을 글로 정리해 줘\n자세히',
      }),
      201,
    );
    assert.equal(task.title, '이번 주 세션을 글로 정리해 줘');
    assert.equal(task.kind, 'general');
    const empty = await api.request('POST', '/api/tasks', owner, { requestId: randomUUID() });
    assert.equal(empty.status, 400);
  });

  test('다른 작업에서 같은 request_id를 써도 결재는 따로 생긴다', async () => {
    const request_id = 'approval-1';
    await newTask(await newAgent());
    const first = await take();
    const asked = await askApproval(first.run_token, { request_id });
    await newTask(await newAgent());
    const second = await take();
    const again = await askApproval(second.run_token, { request_id });
    assert.equal(again.ok, true, JSON.stringify(again.body));
    assert.notEqual(again.body.approval_id, asked.body.approval_id);
  });

  test('같은 request_id의 결재는 하나고 처음 결과를 돌려준다', async () => {
    const task = await newTask(await newAgent());
    const job = await take();
    const request_id = randomUUID();
    const first = await askApproval(job.run_token, { request_id });
    const second = await askApproval(job.run_token, { request_id });
    assert.equal(second.ok, true, JSON.stringify(second.body));
    assert.equal(first.body.approval_id, second.body.approval_id);
    const rows = await db.sql`SELECT id FROM task.approvals WHERE task_id = ${String(task.id)}`;
    assert.equal(rows.length, 1);

    const other = await askApproval(job.run_token);
    assert.equal(other.ok, false);
  });

  test('같은 request_id의 제출은 처음 결과를 돌려준다', async () => {
    const task = await newTask(await newAgent());
    await take();
    const args = { task_id: task.id, request_id: randomUUID(), status: 'done', result: { n: 1 } };
    const first = await tool(runner, 'submit_result', args);
    const second = await tool(runner, 'submit_result', { ...args, result: { n: 2 } });
    assert.deepEqual(first.body, second.body);
    assert.deepEqual((await getTask(task.id)).result, { n: 1 });
  });

  test('같은 request_id의 진행 보고는 토큰을 한 번만 센다', async () => {
    const agent = await newAgent();
    const task = await newTask(agent);
    await take();
    const args = {
      task_id: task.id,
      request_id: randomUUID(),
      events: [{ kind: 'read', tokens: 7 }],
    };
    await tool(runner, 'report_progress', args);
    await tool(runner, 'report_progress', args);
    assert.equal(((await getTask(task.id)).events as Json[]).length, 1);

    // 같은 request_id에 남의 작업 id를 붙여 다시 보내도 그 작업의 상태를 주지 않는다
    const others = await newTask(agent);
    await take();
    await db.sql`UPDATE task.tasks SET leased_by = ${randomUUID()} WHERE id = ${String(others.id)}`;
    const peek = await tool(runner, 'report_progress', { ...args, task_id: others.id });
    assert.equal(peek.ok, false, JSON.stringify(peek.body));
  });

  test('버전이 어긋나면 409', async () => {
    const agent = await newAgent();
    const patch = (version: unknown) =>
      api.request('PATCH', `/api/agents/${agent.id}`, owner, { name: '이름', version });
    ok(await patch(agent.version));
    assert.equal((await patch(agent.version)).status, 409);

    const pause = await api.request('POST', `/api/agents/${agent.id}/pause`, owner, {
      version: agent.version,
    });
    assert.equal(pause.status, 409);

    const queued = await newTask(null);
    const cancel = await api.request('POST', `/api/tasks/${queued.id}/cancel`, owner, {
      version: 99,
    });
    assert.equal(cancel.status, 409);
    // 담당 없는 일이 남으면 아래 빌리기에 섞여, 다른 파일이 먼저 만든 에이전트가 맡을 수 있다
    ok(
      await api.request('POST', `/api/tasks/${queued.id}/cancel`, owner, {
        version: queued.version,
      }),
    );

    await newTask(await newAgent());
    const job = await take();
    const asked = await askApproval(job.run_token);
    const approval = await getApproval(asked.body.approval_id);
    const stale = await decide(approval.id, Number(approval.version) + 1, 'approve');
    assert.equal(stale.status, 409);
    assert.equal((await getApproval(approval.id)).status, 'pending');
  });

  test('이미 정한 결재는 다시 정할 수 없다', async () => {
    await newTask(await newAgent());
    const job = await take();
    const asked = await askApproval(job.run_token);
    const approval = await getApproval(asked.body.approval_id);
    const decided = ok(await decide(approval.id, approval.version, 'approve'));
    assert.equal((await decide(approval.id, decided.version, 'reject')).status, 422);
  });
});

describe('작업 토큰', () => {
  test('작업이 끝나면 토큰도 끝난다', async () => {
    const task = await newTask(await newAgent());
    const job = await take();
    assert.equal((await api.mcp(job.run_token, 'tools/list')).status, 200);
    await tool(runner, 'submit_result', {
      task_id: task.id,
      request_id: randomUUID(),
      status: 'done',
    });
    const res = await api.mcp(job.run_token, 'tools/list');
    assert.equal(res.status, 401);
    assert.equal(res.json().code, 'unauthenticated');
  });

  test('없는 토큰이나 고친 토큰은 401', async () => {
    await newTask(await newAgent());
    const job = await take();
    assert.equal((await api.mcp('cairn_run_nosuchtoken', 'tools/list')).status, 401);
    assert.equal((await api.mcp(`${job.run_token}x`, 'tools/list')).status, 401);
  });

  test('에이전트의 권한만큼만 도구가 보이고 불린다', async () => {
    await newTask(await newAgent({ scopes: ['read_public'] }));
    const reader = await take();
    const names = await toolNames(reader.run_token);
    assert.deepEqual(names, [
      'search_sessions',
      'get_session',
      'search_wikis',
      'get_wiki',
      'neighbors',
      'request_approval',
      'delegate_task',
      'read_url',
    ]);
    assert.equal((await tool(reader.run_token, 'save_session')).body.scope, 'upload');
    assert.equal((await tool(reader.run_token, 'next_jobs')).body.scope, 'run');

    await newTask(await newAgent({ scopes: ['upload'] }));
    const uploader = await take();
    assert.deepEqual((await toolNames(uploader.run_token)).sort(), [
      'check_session',
      'delegate_task',
      'read_url',
      'request_approval',
      'save_session',
    ]);
  });

  test('작업 토큰은 REST에서 쓸 수 없다', async () => {
    await newTask(await newAgent({ scopes: ['write', 'read_all'] }));
    const job = await take();
    const headers = { authorization: `Bearer ${job.run_token}` };
    for (const path of ['/api/agents', '/api/approvals', '/api/devices', '/api/tasks']) {
      const res = await api.request('GET', path, TestUser.visitor, undefined, headers);
      assert.equal(res.status, 403, path);
    }
  });
});

describe('한 달 한도', () => {
  test('넘기면 에이전트가 멈추고 한도 올리기 결재가 생기며, 승인하면 다시 움직인다', async () => {
    const agent = await newAgent({ monthlyLimit: 100 });
    const task = await newTask(agent);
    await take();
    const report = (tokens: number) =>
      tool(runner, 'report_progress', { task_id: task.id, events: [{ kind: 'read', tokens }] });

    assert.equal((await report(60)).body.paused, false);
    assert.equal((await report(40)).body.paused, false);
    assert.equal((await report(1)).body.paused, true);

    const paused = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
    const row = paused.agents.find((a) => a.id === agent.id);
    assert.equal(row?.status, 'paused');
    assert.equal(row?.usedThisMonth, 101);

    // 멈춘 에이전트에게는 일을 빌려주지 않는다
    const next = await newTask(agent);
    assert.deepEqual((await tool(runner, 'next_jobs')).body.jobs, []);

    // 더 써도 결재는 하나
    await report(5);
    const pending = ok(await api.get('/api/approvals?status=pending', owner)) as {
      approvals: Json[];
    };
    const raises = pending.approvals.filter(
      (a) => a.action === 'task.agent.raise_limit' && a.agentId === agent.id,
    );
    assert.equal(raises.length, 1);
    const raise = raises[0] as Json;
    assert.equal(raise.taskId, null);
    assert.equal((raise.target as Json).kind, 'agent');
    assert.equal((raise.target as Json).id, agent.id);

    ok(await decide(raise.id, raise.version, 'approve'));
    const resumed = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
    const active = resumed.agents.find((a) => a.id === agent.id);
    assert.equal(active?.status, 'active');
    assert.equal(active?.monthlyLimit, 200);
    assert.equal((await take()).task.id, next.id);
  });

  test('한도가 없으면 멈추지 않는다', async () => {
    const task = await newTask(await newAgent());
    await take();
    const { body } = await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [{ kind: 'read', tokens: 1_000_000 }],
    });
    assert.equal(body.paused, false);
  });
});

describe('에이전트', () => {
  test('역할은 비울 수 있고, 보내지 않으면 그대로다', async () => {
    const agent = await newAgent({ role: '초안을 쓴다' });
    const kept = ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        version: agent.version,
        name: '새 이름',
      }),
    );
    assert.equal(kept.role, '초안을 쓴다');
    const cleared = ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        version: kept.version,
        role: '',
      }),
    );
    assert.equal(cleared.role, '');
  });

  test('고치고, 멈추고, 다시 시작한다', async () => {
    const agent = await newAgent({ role: '초안을 쓴다', monthlyLimit: 500 });
    const patched = ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        name: '정리',
        monthlyLimit: null,
        version: agent.version,
      }),
    );
    assert.equal(patched.name, '정리');
    assert.equal(patched.role, '초안을 쓴다');
    assert.equal(patched.monthlyLimit, null);

    const paused = ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, {
        version: patched.version,
      }),
    );
    assert.equal(paused.status, 'paused');
    await newTask(agent);
    assert.deepEqual((await tool(runner, 'next_jobs')).body.jobs, []);

    const resumed = ok(
      await api.request('POST', `/api/agents/${agent.id}/resume`, owner, {
        version: paused.version,
      }),
    );
    assert.equal(resumed.status, 'active');
    await take();
  });

  test('권한과 맡길 동작은 목록 그대로 저장된다', async () => {
    const agent = await newAgent({ scopes: ['read_public'], approvalActions: [] });
    ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        scopes: ['write', 'upload'],
        approvalActions: ['blog.post.publish', 'sns.post.send'],
        version: agent.version,
      }),
    );
    const { agents } = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
    const saved = agents.find((a) => a.id === agent.id);
    assert.deepEqual(saved?.scopes, ['upload', 'write']);
    assert.deepEqual(saved?.approvalActions, ['blog.post.publish', 'sns.post.send']);
    // 바꾼 칸만 저장하고 버전은 한 번 오른다
    assert.equal(saved?.name, agent.name);
    assert.equal(saved?.version, Number(agent.version) + 1);
  });

  test('조직도: 보고 대상을 정하고 주인에게 되돌린다. 순환과 없는 대상은 422', async () => {
    const lead = await newAgent({ name: '팀장' });
    const member = await newAgent({ name: '담당', reportsTo: lead.id });
    assert.equal(member.reportsTo, lead.id, '만들 때 정할 수 있다');

    const cycle = await api.request('PATCH', `/api/agents/${lead.id}`, owner, {
      reportsTo: member.id,
      version: lead.version,
    });
    assert.equal(cycle.status, 422, '자기 팀원에게 보고할 수 없다');
    const self = await api.request('PATCH', `/api/agents/${lead.id}`, owner, {
      reportsTo: lead.id,
      version: lead.version,
    });
    assert.equal(self.status, 422);
    const nobody = await api.request('PATCH', `/api/agents/${member.id}`, owner, {
      reportsTo: randomUUID(),
      version: member.version,
    });
    assert.equal(nobody.status, 422, nobody.text);

    const back = ok(
      await api.request('PATCH', `/api/agents/${member.id}`, owner, {
        reportsTo: null,
        version: member.version,
      }),
    );
    assert.equal(back.reportsTo, null, 'null이면 주인에게 보고');
    const kept = ok(
      await api.request('PATCH', `/api/agents/${member.id}`, owner, {
        name: '담당 2',
        version: back.version,
      }),
    );
    assert.equal(kept.reportsTo, null, '보내지 않으면 그대로');
    const { agents } = ok(await api.get('/api/agents', owner)) as { agents: Json[] };
    assert.equal(agents.find((a) => a.id === lead.id)?.reportsTo, null);
  });

  test('조직도는 4단계까지', async () => {
    let boss = await newAgent({ name: '1단계' });
    for (const name of ['2단계', '3단계', '4단계'])
      boss = await newAgent({ name, reportsTo: boss.id });
    const deep = await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '5단계',
      tool: 'claude',
      reportsTo: boss.id,
    });
    assert.equal(deep.status, 422, deep.text);
  });

  test('없는 에이전트에게 일을 시킬 수 없다', async () => {
    const res = await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: randomUUID(),
      kind: 'draft_post',
      title: '일',
    });
    assert.equal(res.status, 404);
  });
});

describe('위임', () => {
  /** 팀장과 바로 아래 팀원 둘 (글쓰기, 정리). 정리 팀원만 세션 정리 권한이 있다 */
  async function team(): Promise<{ lead: Json; writer: Json; tidier: Json }> {
    const lead = await newAgent({ name: '팀장', scopes: ['read_public'], approvalActions: [] });
    const writer = await newAgent({ name: '글쓰기 팀원', reportsTo: lead.id });
    const tidier = await newAgent({
      name: '정리 팀원',
      scopes: ['tidy', 'read_all'],
      approvalActions: ['blog.post.publish'],
      reportsTo: lead.id,
    });
    return { lead, writer, tidier };
  }

  const order = (requestId: string, agent: Json, more: Json = {}) => ({
    request_id: requestId,
    to_agent_id: agent.id,
    title: `${agent.name}의 일`,
    instruction: '맡은 부분을 해 주세요',
    ...more,
  });

  test('팀장 → 팀원 둘 → 모두 끝나면 결과를 싣고 팀장에게 돌아온다', async () => {
    const { lead, writer, tidier } = await team();
    const company = ok(
      await api.request('POST', '/api/goals', owner, { requestId: randomUUID(), title: '회사' }),
      201,
    );
    const goal = ok(
      await api.request('POST', '/api/goals', owner, {
        requestId: randomUUID(),
        title: '이번 달 글 4편',
        parentId: company.id,
      }),
      201,
    );
    const parent = await newTask(lead, { kind: 'general', goalId: goal.id });

    const job = (await take()) as Awaited<ReturnType<typeof take>> & Json;
    assert.equal(job.task.id, parent.id);
    assert.deepEqual(job.goal_chain, [{ title: '회사' }, { title: '이번 달 글 4편' }]);
    assert.deepEqual(
      (job.team as Json[]).map((m) => [m.name, m.kinds]),
      [
        ['글쓰기 팀원', ['general', 'draft_post']],
        ['정리 팀원', ['general', 'draft_post', 'tidy_session']],
      ],
    );
    assert.deepEqual(job.subtask_results, []);
    assert.equal(job.rounds_left, 3);

    const subtasks = [
      order('draft', writer, { kind: 'draft_post' }),
      order('tidy', tidier, { kind: 'tidy_session' }),
    ];
    const delegated = await tool(job.run_token, 'delegate_task', { subtasks });
    assert.equal(delegated.ok, true, JSON.stringify(delegated.body));
    assert.equal(delegated.body.waiting, 'subtasks');
    const made = delegated.body.subtasks as Json[];
    assert.deepEqual(
      made.map((m) => [m.to_agent_id, m.status]),
      [
        [writer.id, 'queued'],
        [tidier.id, 'queued'],
      ],
    );
    // 응답을 놓쳐 다시 보내도 하위 작업은 그대로 둘이다
    const again = await tool(job.run_token, 'delegate_task', { subtasks });
    assert.deepEqual(
      (again.body.subtasks as Json[]).map((m) => m.task_id),
      made.map((m) => m.task_id),
    );

    const waiting = await getTask(parent.id);
    assert.equal(waiting.status, 'waiting');
    assert.equal(waiting.waitReason, 'subtasks');
    // 같은 때 만든 둘의 id 순서는 정해지지 않는다 (UUIDv7은 같은 밀리초 안에서 순서가 없다)
    assert.deepEqual(
      (waiting.children as Json[]).map((c) => String(c.id)).sort(),
      made.map((m) => String(m.task_id)).sort(),
    );
    // 러너는 진행 보고의 답으로 AI를 끄고 제출하지 않는다 (결재 대기와 같다)
    const progress = await tool(runner, 'report_progress', { task_id: parent.id, events: [] });
    assert.equal(progress.body.status, 'waiting');

    // 팀원의 일: 목표를 물려받고, 글쓰기는 끝내고 정리는 실패한다. 같은 때 만든 둘은 어느 쪽이 먼저 나올지 정하지 않는다
    const first = (await take()) as Awaited<ReturnType<typeof take>> & Json;
    assert.deepEqual(first.goal_chain, job.goal_chain);
    assert.deepEqual(first.team, [], '팀원에게는 팀이 없다');
    const finish = (child: Awaited<ReturnType<typeof take>>) =>
      child.agent.name === '글쓰기 팀원'
        ? tool(runner, 'submit_result', {
            task_id: child.task.id,
            request_id: randomUUID(),
            status: 'done',
            result: { text: '초안을 썼어요' },
          })
        : tool(runner, 'submit_result', {
            task_id: child.task.id,
            request_id: randomUUID(),
            status: 'failed',
            error: '세션이 없어요',
          });
    assert.equal((await finish(first)).ok, true);
    await drain();
    assert.equal((await getTask(parent.id)).status, 'waiting', '하나가 남아 아직 기다린다');

    const second = await take();
    assert.deepEqual(
      [first.task.id, second.task.id].sort(),
      made.map((m) => String(m.task_id)).sort(),
    );
    assert.equal((await finish(second)).ok, true);
    await drain();
    const woke = await getTask(parent.id);
    assert.equal(woke.status, 'queued');
    assert.equal(woke.waitReason, null);

    const back = (await take()) as Awaited<ReturnType<typeof take>> & Json;
    assert.equal(back.task.id, parent.id);
    assert.equal(back.agent.name, '팀장');
    assert.deepEqual(
      (back.subtask_results as Json[])
        .map((r) => [r.title, r.agent, r.status, r.summary, r.error])
        .sort(),
      [
        ['글쓰기 팀원의 일', '글쓰기 팀원', 'done', '초안을 썼어요', null],
        ['정리 팀원의 일', '정리 팀원', 'failed', null, '세션이 없어요'],
      ],
    );
    assert.equal(back.rounds_left, 2);
    const done = await tool(runner, 'submit_result', {
      task_id: parent.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '모아서 보고' },
    });
    assert.equal(done.body.status, 'done');
  });

  test('바로 아래 팀이 아니면 forbidden, 권한으로 못 하는 일은 rule_violation, 기다리는 중이면 conflict', async () => {
    const { lead, writer } = await team();
    const outsider = await newAgent({ name: '다른 팀' });
    await newTask(lead, { kind: 'general' });
    const job = await take();

    const notMine = await tool(job.run_token, 'delegate_task', {
      subtasks: [order('x', outsider)],
    });
    assert.equal(notMine.ok, false);
    assert.equal(notMine.body.code, 'forbidden');
    const cannot = await tool(job.run_token, 'delegate_task', {
      subtasks: [order('y', writer, { kind: 'tidy_session' })],
    });
    assert.equal(cannot.body.code, 'rule_violation');
    const tooMany = await tool(job.run_token, 'delegate_task', {
      subtasks: ['1', '2', '3', '4', '5', '6'].map((id) => order(id, writer)),
    });
    assert.equal(tooMany.body.code, 'rule_violation', '한 번에 5개까지');

    const once = await tool(job.run_token, 'delegate_task', { subtasks: [order('z', writer)] });
    assert.equal(once.ok, true, JSON.stringify(once.body));
    const twice = await tool(job.run_token, 'delegate_task', { subtasks: [order('w', writer)] });
    assert.equal(twice.body.code, 'conflict', '하위 작업을 기다리는 중');
    const approval = await askApproval(job.run_token);
    assert.equal(approval.ok, false, '하위 작업을 기다리는 중에는 결재도 올리지 못한다');
  });

  test('팀원은 자기 팀이 없으면 맡기지 못하고, 기기에게는 위임 도구가 보이지 않는다', async () => {
    const { writer } = await team();
    await newTask(writer, { kind: 'general' });
    const job = await take();
    assert.ok((await toolNames(job.run_token)).includes('delegate_task'));
    const none = await tool(job.run_token, 'delegate_task', {
      subtasks: [order('a', { id: randomUUID(), name: '없는 에이전트' })],
    });
    assert.equal(none.body.code, 'forbidden');
    assert.equal((await toolNames(runner)).includes('delegate_task'), false);
    assert.equal((await toolNames(laptop)).includes('delegate_task'), false);
  });

  test('위 작업을 취소하면 끝나지 않은 아래 작업도 함께 취소되고 기다리던 결재도 닫힌다', async () => {
    const { lead, writer, tidier } = await team();
    const parent = await newTask(lead, { kind: 'general' });
    const job = await take();
    const made = (
      await tool(job.run_token, 'delegate_task', {
        subtasks: [order('a', writer), order('b', tidier)],
      })
    ).body.subtasks as Json[];
    // 먼저 나온 팀원은 일을 시작해 결재를 올린다 (둘 다 글 공개를 맡을 수 있다)
    const child = await take();
    assert.equal((await askApproval(child.run_token)).ok, true);

    const before = await getTask(parent.id);
    const cancelled = ok(
      await api.request('POST', `/api/tasks/${parent.id}/cancel`, owner, {
        version: before.version,
      }),
    );
    assert.equal(cancelled.status, 'cancelled');
    for (const m of made) assert.equal((await getTask(m.task_id)).status, 'cancelled');
    const pending = ok(await api.get('/api/approvals?status=pending', owner)) as {
      approvals: Json[];
    };
    assert.equal(
      pending.approvals.some((a) => a.taskId === child.task.id),
      false,
    );
    await drain();
    assert.equal((await getTask(parent.id)).status, 'cancelled', '취소된 위 작업은 깨우지 않는다');
  });
});

describe('목록', () => {
  test('작업 목록은 상태로 거르고 커서로 넘긴다', async () => {
    const agent = await newAgent();
    const ids: unknown[] = [];
    for (let i = 0; i < 32; i++) ids.push((await newTask(agent)).id);
    const first = ok(await api.get('/api/tasks?status=queued', owner)) as {
      tasks: Json[];
      next: string | null;
    };
    assert.equal(first.tasks.length, 30);
    assert.equal(first.tasks[0]?.id, ids.at(-1));
    assert.equal(typeof first.next, 'string');
    const second = ok(await api.get(`/api/tasks?status=queued&cursor=${first.next}`, owner)) as {
      tasks: Json[];
      next: string | null;
    };
    assert.equal(second.tasks.length, 2);
    assert.equal(second.next, null);
  });
});

describe('긴 폴링', () => {
  test('일이 없으면 기다리다가 일이 생기면 바로 돌려준다', async () => {
    const agent = await newAgent();
    const started = Date.now();
    const polling = tool(runner, 'next_jobs', { wait_seconds: 15 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const task = await newTask(agent);
    const { body } = await polling;
    const elapsed = Date.now() - started;
    assert.equal((body.jobs as { task: Json }[])[0]?.task.id, task.id);
    assert.equal(elapsed < 4000, true, `${elapsed}ms`);
  });

  test('일이 없으면 시간이 다 된 뒤 빈 목록을 돌려준다', async () => {
    const started = Date.now();
    const { body } = await tool(runner, 'next_jobs', { wait_seconds: 1 });
    assert.deepEqual(body.jobs, []);
    assert.equal(Date.now() - started >= 1000, true);
  });

  test('wait_seconds는 25초까지다', async () => {
    const { ok: done, body } = await tool(runner, 'next_jobs', { wait_seconds: 26 });
    assert.equal(done, false);
    assert.equal(body.code, 'invalid_request');
  });

  test('동시에 빌려도 일 하나는 러너 하나에게만 간다', async () => {
    const agent = await newAgent();
    const tasks = [await newTask(agent), await newTask(agent), await newTask(agent)];
    const results = await Promise.all(
      Array.from({ length: 6 }, () => tool(runner, 'next_jobs', { limit: 2 })),
    );
    const leased = results.flatMap((r) => (r.body.jobs as { task: Json }[]).map((j) => j.task.id));
    assert.equal(leased.length, tasks.length);
    assert.equal(new Set(leased).size, tasks.length);
  });
});

describe('실시간', () => {
  test('/api/stream은 변경 신호를 보내고 no-transform이 응답까지 간다', async () => {
    const stop = new AbortController();
    const res = await fetch(`${api.baseUrl}/api/stream`, {
      headers: { cookie: owner.header },
      signal: stop.signal,
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store, no-transform');
    assert.match(res.headers.get('content-type') ?? '', /^text\/event-stream/);

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = '';
    const until = async (found: () => boolean) => {
      while (!found()) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };
    await until(() => text.includes(': 연결됨'));

    const task = await newTask(await newAgent());
    const changed = JSON.stringify({ topic: 'task.task.changed', id: task.id });
    await until(() => text.includes(changed));
    assert.equal(text.includes(`data: ${changed}\n\n`), true);

    // 진행 기록도 신호를 보낸다
    await take();
    await tool(runner, 'report_progress', {
      task_id: task.id,
      events: [{ kind: 'read', body: '읽는 중' }],
    });
    const logged = JSON.stringify({ topic: 'task.event.added', id: task.id });
    await until(() => text.includes(logged));
    assert.equal(text.includes(logged), true);
    // 신호에는 내용도 공간도 없다
    assert.equal(text.includes('spaceId'), false);
    stop.abort();
  });

  test('취소된 트랜잭션의 신호는 나가지 않는다', async () => {
    const stop = new AbortController();
    const res = await fetch(`${api.baseUrl}/api/stream`, {
      headers: { cookie: owner.header },
      signal: stop.signal,
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    const space = await spaceId();
    await assert.rejects(
      db.transaction(async (tx) => {
        await new Outbox(tx).publish([
          new DomainEvent('task.probe.rolled_back', 1, space, { id: 'x' }),
        ]);
        throw new Error('되돌린다');
      }),
    );
    await publish(new DomainEvent('task.probe.committed', 1, space, { id: 'x' }));
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('task.probe.committed')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    assert.equal(text.includes('task.probe.rolled_back'), false);
    stop.abort();
  });

  test('브라우저가 닫으면 받는 쪽이 사라진다', async () => {
    const receivers = await noReceivers();
    const stop = new AbortController();
    const res = await fetch(`${api.baseUrl}/api/stream`, {
      headers: { cookie: owner.header },
      signal: stop.signal,
    });
    await (res.body as ReadableStream<Uint8Array>).getReader().read();
    assert.equal(receivers.size, 1);
    stop.abort();
    await noReceivers();
  });

  test('긴 폴링이 끝나면 받는 쪽이 사라진다', async () => {
    const receivers = await noReceivers();
    await tool(runner, 'next_jobs', { wait_seconds: 1 });
    assert.equal(receivers.size, 0);
  });

  test('서버가 내려가면 긴 폴링도 기다리지 않고 돌아간다', async () => {
    const other = await ApiClient.start();
    const stream = other.service(ChangeStream);
    const started = Date.now();
    const waiting = stream.wait(() => false, 20_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await other.close();
    assert.equal(await waiting, false);
    assert.equal(Date.now() - started < 5000, true);
    assert.equal(stream.closed, true);
    assert.equal(await stream.wait(() => true, 20_000), false);
  });

  test('서버가 내려갈 때 열린 스트림이 닫힌다', async () => {
    const other = await ApiClient.start();
    const res = await fetch(`${other.baseUrl}/api/stream`, { headers: { cookie: owner.header } });
    assert.equal(res.status, 200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await other.close();
    let ended = false;
    while (!ended) ended = (await reader.read()).done;
    assert.equal(ended, true);
  });
});
