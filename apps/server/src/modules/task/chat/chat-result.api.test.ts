import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 결과 결재 (2차 2단계): 대화 한 회차의 결재는 결과 카드 하나로. 도중 결재는 따로 정하지 못하고 카드에 실린다.
// 승인은 고른 것만 남기고(고른 결재는 승인, 고르지 않은 결재는 반려, 고르지 않은 결과물은 휴지통), 수정 요청은 다음 회차,
// 반려는 결과물을 휴지통으로. 받을 것이 없으면 두 번까지 다시 맡기고, 검토자 짝이 있으면 카드 전에 검토한다. 멈추기는 모두 취소.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let runner: string;
let worker: OutboxWorker;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

/** 일꾼(outbox)이 할 일을 다 한다: 소식 · 결과 카드 · 카드 뒤의 정리 */
async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent ?? {};
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
const open = async (agentId: string, message: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      agentId,
      message,
      ...more,
    }),
    201,
  );
const detail = async (id: string) => ok(await api.get(`/api/chats/${id}`, owner));
const decide = (card: Json, decision: string, more: Json = {}) =>
  api.request('POST', `/api/approvals/${card.id}/decide`, owner, {
    version: card.version,
    decision,
    ...more,
  });

/** 러너가 빌릴 수 있는 일을 모두 빌린다 */
async function jobs(): Promise<Json[]> {
  return (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
}

/** 이 대화의 회차 일 하나를 빌린다 */
async function turnJob(chatId: string): Promise<Json> {
  const job = (await jobs()).find((j) => j.task.payload.chat?.chatId === chatId);
  assert.ok(job, '대화의 일이 빌려지지 않았다');
  return job;
}

/** 일이 만든 결과물 (러너가 올린 것처럼 실행에 묶어 넣는다) */
async function made(job: Json, name: string): Promise<string> {
  const [run] =
    await db.sql`SELECT id, space_id FROM task.task_runs WHERE task_id = ${job.task.id}`;
  const [row] = await db.sql`
    INSERT INTO task.outputs (space_id, task_id, run_id, name, kind, mime, size_bytes, blob_hash)
    VALUES (${run?.space_id}, ${job.task.id}, ${run?.id}, ${name}, 'document', 'text/html', 10, ${'b'.repeat(64)})
    RETURNING id`;
  return String(row?.id);
}

const done = (job: Json, text = '끝났어요') =>
  tool(runner, 'submit_result', {
    task_id: job.task.id,
    request_id: randomUUID(),
    status: 'done',
    result: { text },
  });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  worker = api.service(OutboxWorker);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '카드', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'card-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'card-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});
after(() => api.close());

beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('결과 카드', () => {
  test('회차가 끝나면 결과물이 카드 하나에 실리고, 승인하면 고른 것만 남는다. 방문자는 정하지 못한다', async () => {
    const partner = await agent('카드 대표');
    const chat = await open(partner.id, '자료 두 개 만들어 줘');
    const job = await turnJob(chat.id);
    const keep = await made(job, '남길 것.html');
    const drop = await made(job, '버릴 것.html');
    await done(job);
    await drain();
    const card = (await detail(chat.id)).card;
    assert.deepEqual(
      card.items.map((i: Json) => [i.kind, i.label]),
      [
        ['output', '남길 것.html'],
        ['output', '버릴 것.html'],
      ],
    );
    assert.deepEqual([card.deliver, card.passed, card.review], [null, true, null]);
    const inbox = ok(await api.get('/api/approvals?status=pending', owner)).approvals as Json[];
    assert.ok(inbox.some((a) => a.id === card.id && a.action === 'task.chat.result'));
    const home = ok(await api.get('/api/home', owner));
    assert.ok(home.pendingApprovals >= 1);
    assert.equal(home.chats.find((c: Json) => c.id === chat.id)?.state, 'waiting_approval');

    const visitor = await api.request(
      'POST',
      `/api/approvals/${card.id}/decide`,
      TestUser.visitor,
      {
        version: card.version,
        decision: 'approve',
      },
    );
    assert.equal(visitor.status, 403);
    assert.equal((await decide(card, 'approve', { picked: [randomUUID()] })).status, 422);
    ok(await decide(card, 'approve', { picked: [keep] }));
    const rows = await db.sql`
      SELECT id, deleted_at FROM task.outputs WHERE id = ANY(${[keep, drop]}::uuid[])`;
    const trashed = new Map(rows.map((r) => [String(r.id), r.deleted_at !== null]));
    assert.deepEqual([trashed.get(keep), trashed.get(drop)], [false, true]);
    await drain();
    assert.equal(
      (await detail(chat.id)).card,
      null,
      '정한 카드는 사라지고 같은 결과물은 다시 실리지 않는다',
    );
  });

  test('대화의 일에서 올린 결재는 따로 정하지 못하고 카드에 실린다. 고르지 않은 결재는 반려된다', async () => {
    const partner = await agent('결재 대표', { approvalActions: ['qa.post.send'] });
    const chat = await open(partner.id, '보내 줘');
    const job = await turnJob(chat.id);
    const output = await made(job, '보낼 글.html');
    const asked = await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'qa.post.send',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
      note: '보내도 될까요',
    });
    const alone = ok(await api.get(`/api/approvals/${asked.approval_id}`, owner));
    assert.equal(
      (await decide(alone, 'approve')).status,
      422,
      '대화의 결재는 결과 카드에서 정한다',
    );
    const inbox = ok(await api.get('/api/approvals?status=pending', owner)).approvals as Json[];
    assert.equal(
      inbox.some((a) => a.id === asked.approval_id),
      false,
      '목록에는 카드만 보인다',
    );
    await drain();
    const room = await detail(chat.id);
    assert.equal(room.turns[0].approvalIds.length, 0);
    assert.deepEqual(
      room.card.items.map((i: Json) => [i.kind, i.id]),
      [
        ['action', asked.approval_id],
        ['output', output],
      ],
      '결재를 기다리며 가라앉은 회차도 카드가 된다',
    );
    ok(await decide(room.card, 'approve', { picked: [output] }));
    const [action] =
      await db.sql`SELECT status FROM task.approvals WHERE id = ${asked.approval_id}`;
    const [task] = await db.sql`SELECT status FROM task.tasks WHERE id = ${job.task.id}`;
    assert.deepEqual([action?.status, task?.status], ['rejected', 'cancelled']);
  });

  test('수정 요청은 메모를 다음 회차로 보내고 결과물은 남긴다. 반려는 결과물을 휴지통으로', async () => {
    const partner = await agent('수정 대표');
    const chat = await open(partner.id, '초안 써 줘');
    const job = await turnJob(chat.id);
    const draft = await made(job, '초안.html');
    await done(job);
    await drain();
    const card = (await detail(chat.id)).card;
    assert.equal((await decide(card, 'revise')).status, 422, '고칠 내용이 있어야 한다');
    ok(await decide(card, 'revise', { note: '제목을 더 짧게' }));
    await drain();
    const room = await detail(chat.id);
    assert.deepEqual(
      [room.chat.turns, room.turns.at(-1).message, room.card],
      [2, '제목을 더 짧게', null],
    );
    const [kept] = await db.sql`SELECT deleted_at FROM task.outputs WHERE id = ${draft}`;
    assert.equal(kept?.deleted_at, null);

    const second = await turnJob(chat.id);
    const again = await made(second, '고친 초안.html');
    await done(second);
    await drain();
    ok(await decide((await detail(chat.id)).card, 'reject'));
    const [gone] = await db.sql`SELECT deleted_at FROM task.outputs WHERE id = ${again}`;
    assert.notEqual(gone?.deleted_at, null);
  });

  test('받을 것이 없으면 두 번까지 다시 맡기고, 그다음은 떨어진 채로 끝난다. 있으면 검사를 통과한 카드', async () => {
    const partner = await agent('검사 대표');
    assert.equal(
      (
        await api.request('POST', '/api/chats', owner, {
          requestId: randomUUID(),
          agentId: partner.id,
          message: 'x',
          deliver: 'pdf',
        })
      ).status,
      422,
    );
    const chat = await open(partner.id, '발표 자료 만들어 줘', { deliver: 'html' });
    for (const turn of [1, 2, 3]) {
      await done(await turnJob(chat.id), `${turn}번째 답`);
      await drain();
    }
    const room = await detail(chat.id);
    assert.deepEqual(
      room.turns.map((t: Json) => t.fix),
      [false, true, true],
    );
    assert.match(room.turns[1].message, /html/);
    assert.equal(room.chat.turns, 3, '두 번 다시 맡긴 뒤에는 멈춘다');
    assert.equal(room.card, null, '실을 것이 없으면 카드도 없다');

    const next = await open(partner.id, '페이지 만들어 줘', { deliver: 'html' });
    const job = await turnJob(next.id);
    await made(job, 'index.html');
    await done(job);
    await drain();
    const card = (await detail(next.id)).card;
    assert.deepEqual([card.deliver, card.passed], ['html', true]);
  });

  test('검토자 짝: 다른 도구의 에이전트만. 회차가 끝나면 검토가 먼저 돌고, 그 의견이 카드에 실린다', async () => {
    const lead = await agent('검토받는 대표');
    const same = await agent('같은 도구');
    const other = await agent('다른 도구', { tool: 'codex' });
    const pair = (reviewerId: string | null, version: number) =>
      api.request('PATCH', `/api/agents/${lead.id}`, owner, { reviewerId, version });
    assert.equal((await pair(same.id, lead.version)).status, 422);
    assert.equal((await pair(lead.id, lead.version)).status, 422);
    const paired = ok(await pair(other.id, lead.version));
    assert.equal(paired.reviewerId, other.id);

    const chat = await open(lead.id, '보고서 써 줘');
    const job = await turnJob(chat.id);
    await made(job, '보고서.html');
    await done(job, '보고서를 썼어요');
    await drain();
    assert.equal((await detail(chat.id)).card, null, '검토 전에는 카드가 없다');
    const review = (await jobs()).find((j) => j.task.payload.chat?.review === true) as Json;
    assert.equal(review.agent.id, other.id);
    assert.match(review.instruction, /보고서를 썼어요/);
    assert.match(review.instruction, /보고서\.html/);
    await done(review, '그대로 승인. 근거가 충분해요');
    await drain();
    const room = await detail(chat.id);
    assert.equal(room.card.review, '그대로 승인. 근거가 충분해요');
    assert.ok(room.news.some((n: Json) => n.kind === 'review'));
  });

  test('멈추기: 도는 일 · 기다리는 결재 · 카드를 모두 취소한다. 낡은 판은 409', async () => {
    const partner = await agent('멈출 대표', { approvalActions: ['qa.post.send'] });
    const chat = await open(partner.id, '길게 일해 줘');
    const job = await turnJob(chat.id);
    const asked = await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'qa.post.send',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
    });
    await drain();
    const room = await detail(chat.id);
    assert.ok(room.card);
    assert.equal(
      (await api.request('POST', `/api/chats/${chat.id}/stop`, owner, { version: 999 })).status,
      409,
    );
    ok(
      await api.request('POST', `/api/chats/${chat.id}/stop`, owner, {
        version: room.chat.version,
      }),
    );
    const states = await db.sql`
      SELECT (SELECT status FROM task.tasks WHERE id = ${job.task.id}) AS task,
        (SELECT status FROM task.approvals WHERE id = ${asked.approval_id}) AS action,
        (SELECT status FROM task.approvals WHERE id = ${room.card.id}) AS card`;
    assert.deepEqual(states[0], { task: 'cancelled', action: 'cancelled', card: 'cancelled' });
  });
});
