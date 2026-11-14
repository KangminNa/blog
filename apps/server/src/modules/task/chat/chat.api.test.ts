import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 대화: 관리자만. 상대는 관리자 바로 아래 에이전트. 메시지 하나 = 상대에게 맡긴 작업 하나 (회차).
// 답을 기다리는 동안은 보내지 않고(409), 앞 대화는 다음 회차의 payload.chat.history에 자료로 실린다.
// 회차 아래(위임한 하위 작업 포함)의 결과물 · 기다리는 결재가 그 회차에 실린다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한을 준 기기 (러너) */
let runner: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
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
const open = (agentId: unknown, message: string, requestId = randomUUID()) =>
  api.request('POST', '/api/chats', owner, { requestId, agentId, message });
const detail = async (id: unknown) => ok(await api.get(`/api/chats/${id}`, owner));
const send = (chat: Json, message: string, requestId = randomUUID(), version = chat.version) =>
  api.request('POST', `/api/chats/${chat.id}/messages`, owner, { requestId, version, message });
const task = async (id: unknown) => ok(await api.get(`/api/tasks/${id}`, owner));

/** 러너가 빌릴 수 있는 일을 모두 빌린다 */
async function jobs(): Promise<Json[]> {
  return (await tool(runner, 'next_jobs', { limit: 5 })).jobs ?? [];
}

/** 러너가 일을 하나 빌린다 */
async function take(): Promise<Json> {
  const { jobs } = await tool(runner, 'next_jobs');
  assert.equal(jobs.length, 1, JSON.stringify(jobs));
  return jobs[0];
}

/** 기기 토큰으로 MCP 도구를 부른다. 실패면 ok: false와 오류 모양 */
async function call(token: string, name: string, args: Json): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

/** 이름의 기기를 연결하고, 권한을 더한다 */
async function device(name: string, more: string[] = []): Promise<string> {
  const token = await api.connectDevice(owner, name);
  if (more.length === 0) return token;
  const { devices } = ok(await api.get('/api/devices', owner));
  const d = (devices as Json[]).find((x) => x.name === name) as Json;
  ok(
    await api.request('PATCH', `/api/devices/${d.id}`, owner, {
      scopes: [...d.scopes, ...more],
      version: d.version,
    }),
  );
  return token;
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '대화', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'chat-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
  const device = devices.find((d) => d.name === 'chat-runner') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: [...device.scopes, 'run'],
      version: device.version,
    }),
  );
});
after(() => api.close());

/** 이 테스트의 일만 빌려 가게 앞 테스트가 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('대화', () => {
  test('방문자 · write 기기는 보지도 보내지도 못한다 (403)', async () => {
    const partner = await agent('비서');
    const chat = ok(await open(partner.id, '안녕'), 201);
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `chat-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer]) {
      const calls: [string, string, Json | undefined][] = [
        ['GET', '/api/chats', undefined],
        ['GET', `/api/chats/${chat.id}`, undefined],
        ['POST', '/api/chats', { requestId: randomUUID(), agentId: partner.id, message: '몰래' }],
        [
          'POST',
          `/api/chats/${chat.id}/messages`,
          { requestId: randomUUID(), version: chat.version, message: '몰래' },
        ],
      ];
      for (const [method, path, body] of calls) {
        const res = await api.request(method, path, TestUser.visitor, body, headers);
        assert.equal(res.status, 403, `${method} ${path} ${res.text}`);
      }
    }
  });

  test('메시지 하나 = 상대에게 맡긴 작업 하나. 답을 기다리는 동안은 409, 답이 오면 다음 회차에 이전 대화가 실린다', async () => {
    const partner = await agent('비서');
    const requestId = randomUUID();
    const chat = ok(await open(partner.id, '주말 계획 세워 줘\n둘이서 서울에서', requestId), 201);
    assert.deepEqual([chat.title, chat.turns], ['주말 계획 세워 줘', 1]);
    assert.equal(ok(await open(partner.id, '또', requestId), 201).id, chat.id, '같은 requestId');

    const first = (await detail(chat.id)).turns[0];
    assert.deepEqual(
      [first.turn, first.message, first.status, first.reply],
      [1, '주말 계획 세워 줘\n둘이서 서울에서', 'queued', null],
    );
    const made = await task(first.taskId);
    assert.deepEqual([made.kind, made.agentId], ['general', partner.id]);
    assert.deepEqual(made.payload.chat.history, [], '첫 회차에는 이전 대화가 없다');

    const early = await send(chat, '아직이야?');
    assert.equal(early.status, 409, early.text);

    const job = await take();
    assert.equal(job.task.id, first.taskId);
    await tool(runner, 'submit_result', {
      task_id: job.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '## 계획\n- 성수 카페' },
    });
    const answered = await detail(chat.id);
    assert.deepEqual(
      [answered.turns[0].status, answered.turns[0].reply],
      ['done', '## 계획\n- 성수 카페'],
    );

    const again = randomUUID();
    const second = ok(await send(answered.chat, '저녁은?', again), 201);
    assert.equal(second.turns, 2);
    const resent = ok(await send(answered.chat, '저녁은?', again), 201);
    assert.equal(resent.turns, 2, '같은 requestId는 한 번 (본 version이 낡아도)');
    const turns = (await detail(chat.id)).turns;
    assert.equal(turns.length, 2);
    assert.deepEqual((await task(turns[1].taskId)).payload.chat.history, [
      { from: 'owner', text: '주말 계획 세워 줘\n둘이서 서울에서' },
      { from: 'agent', text: '## 계획\n- 성수 카페' },
    ]);
    assert.equal((await send(answered.chat, '늦은 version')).status, 409);

    const { chats } = ok(await api.get('/api/chats', owner));
    const listed = chats.find((c: Json) => c.id === chat.id);
    assert.deepEqual(
      [listed.agentName, listed.turns, listed.lastStatus],
      [partner.name, 2, 'queued'],
    );
  });

  test('팀원 · 멈춘 에이전트와는 열지 못한다 (422). 상대를 지우면 대화는 보이고 보내기는 404', async () => {
    const lead = await agent('팀장');
    const member = await agent('팀원', { reportsTo: lead.id });
    assert.equal((await open(member.id, '안녕')).status, 422);
    const resting = await agent('쉬는');
    ok(
      await api.request('POST', `/api/agents/${resting.id}/pause`, owner, {
        version: resting.version,
      }),
    );
    assert.equal((await open(resting.id, '안녕')).status, 422);

    const gone = await agent('떠날');
    const chat = ok(await open(gone.id, '안녕'), 201);
    const turn = (await detail(chat.id)).turns[0];
    ok(
      await api.request('POST', `/api/tasks/${turn.taskId}/cancel`, owner, {
        version: turn.taskVersion,
      }),
    );
    const fresh = ok(await api.get('/api/agents', owner)).agents.find(
      (a: Json) => a.id === gone.id,
    );
    ok(
      await api.request('POST', `/api/agents/${gone.id}/delete`, owner, { version: fresh.version }),
    );
    const after = await detail(chat.id);
    assert.deepEqual([after.partner.deleted, after.turns[0].status], [true, 'cancelled']);
    assert.equal((await send(after.chat, '돌아와')).status, 404);
  });

  test('회차 아래에서 올린 결재 · 만든 결과물이 그 회차에 실린다', async () => {
    const partner = await agent('발행', {
      scopes: ['read_public', 'write'],
      approvalActions: ['blog.post.publish'],
    });
    const chat = ok(await open(partner.id, '글 올려 줘'), 201);
    const job = await take();
    await tool(job.run_token, 'request_approval', {
      request_id: randomUUID(),
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
      note: '공개해 주세요',
    });
    const [run] =
      await db.sql`SELECT id, space_id FROM task.task_runs WHERE task_id = ${job.task.id}`;
    await db.sql`
      INSERT INTO task.outputs (space_id, task_id, run_id, name, kind, mime, size_bytes, blob_hash)
      VALUES (${run?.space_id}, ${job.task.id}, ${run?.id}, 'deck.html', 'document', 'text/html', 10, ${'a'.repeat(64)})`;
    const turn = (await detail(chat.id)).turns[0];
    assert.equal(turn.status, 'waiting');
    assert.equal(turn.approvalIds.length, 1);
    assert.deepEqual(
      turn.outputs.map((o: Json) => o.name),
      ['deck.html'],
    );
  });
});

describe('내 컴퓨터의 AI 도구가 서버 팀에 맡기기 (MCP ask_agent · agent_reply, 기기 권한 delegate)', () => {
  test('권한이 없는 기기에는 도구가 보이지 않고, 부르면 delegate 권한을 알린다', async () => {
    const plain = await device(`plain-${randomUUID().slice(0, 6)}`);
    const list = await api.mcp(plain, 'tools/list');
    const names = (list.json().result as Json).tools.map((t: Json) => t.name);
    assert.equal(names.includes('ask_agent'), false);
    const refused = await call(plain, 'ask_agent', { request_id: randomUUID(), message: '검토' });
    assert.deepEqual([refused.ok, refused.body.scope], [false, 'delegate']);
  });

  test('보내고 답을 기다려 받는다. 관리자의 대화 목록에도 보인다. 같은 request_id는 한 번, 답을 기다리는 동안은 409', async () => {
    const partner = await agent('대회 팀장');
    await agent('다른 팀장');
    const mac = await device(`mac-${randomUUID().slice(0, 6)}`, ['delegate']);
    const names = await api.mcp(mac, 'tools/list');
    const tools = (names.json().result as Json).tools.map((t: Json) => t.name);
    assert.ok(tools.includes('ask_agent') && tools.includes('agent_reply'));

    const nobody = await call(mac, 'ask_agent', { request_id: randomUUID(), message: '검토' });
    assert.equal(nobody.ok, false);
    assert.match(nobody.body.message, /상대를 정해요/);
    assert.match(nobody.body.message, new RegExp(partner.name));

    const requestId = randomUUID();
    const sent = await call(mac, 'ask_agent', {
      request_id: requestId,
      message: '이 분석 검토해 줘\n결론: A안',
      agent: partner.name,
    });
    assert.equal(sent.ok, true, JSON.stringify(sent.body));
    const chatId = sent.body.id;
    assert.ok(sent.body.deviceId, '기기가 연 대화');
    const again = await call(mac, 'ask_agent', {
      request_id: requestId,
      message: '이 분석 검토해 줘',
      agent: partner.name,
    });
    assert.equal(again.body.id, chatId, '같은 request_id는 같은 대화');

    const waiting = await call(mac, 'agent_reply', { chat_id: chatId, wait_seconds: 0 });
    assert.deepEqual([waiting.body.answered, waiting.body.turn.status], [false, 'queued']);
    const busy = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '아직?',
      chat_id: chatId,
    });
    assert.deepEqual([busy.ok, busy.body.code], [false, 'conflict']);

    const job = await take();
    assert.equal(job.task.payload.chat.via, 'device');
    const replying = call(mac, 'agent_reply', { chat_id: chatId, wait_seconds: 10 });
    await tool(runner, 'submit_result', {
      task_id: job.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '## 검토\n- 고칠 것: 근거 2' },
    });
    const answer = (await replying).body;
    assert.deepEqual(
      [answer.answered, answer.turn.reply, answer.turn.fromDevice],
      [true, '## 검토\n- 고칠 것: 근거 2', true],
    );
    assert.equal(answer.consolePath, `/admin/chats?chat=${chatId}`);

    const { chats } = ok(await api.get('/api/chats', owner));
    assert.ok((chats as Json[]).some((c) => c.id === chatId && c.deviceId === sent.body.deviceId));
    const next = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '고쳤어. 다시 봐 줘',
      chat_id: chatId,
    });
    assert.equal(next.body.turns, 2);
  });

  test('다른 기기 · 관리자의 대화는 없는 것처럼 (404). 기기의 메시지는 read_url의 기준이 아니다', async () => {
    const partner = await agent('비공개 팀장', { scopes: ['read_all'] });
    const mine = await device(`a-${randomUUID().slice(0, 6)}`, ['delegate']);
    const other = await device(`b-${randomUUID().slice(0, 6)}`, ['delegate']);
    const sent = await call(mine, 'ask_agent', {
      request_id: randomUUID(),
      message: 'https://example.com/brief 읽고 검토해 줘',
      agent: partner.id,
    });
    const chatId = sent.body.id;
    for (const [name, args] of [
      ['agent_reply', { chat_id: chatId, wait_seconds: 0 }],
      ['ask_agent', { request_id: randomUUID(), message: '끼어들기', chat_id: chatId }],
    ] as const) {
      const res = await call(other, name, args);
      assert.deepEqual([res.ok, res.body.code], [false, 'not_found'], name);
    }
    const ownerChat = ok(await open(partner.id, '관리자의 대화'), 201);
    const into = await call(mine, 'ask_agent', {
      request_id: randomUUID(),
      message: '이어서',
      chat_id: ownerChat.id,
    });
    assert.deepEqual([into.ok, into.body.code], [false, 'not_found']);

    // 비공개를 읽는 에이전트는 관리자의 지시에 적힌 사이트만 연다. 기기의 메시지에 적힌 주소는 그 기준이 아니다
    const job = (await jobs()).find((j) => j.task.payload.chat?.chatId === chatId) as Json;
    const read = await api.mcp(job.run_token, 'tools/call', {
      name: 'read_url',
      arguments: { url: 'https://example.com/brief' },
    });
    const result = read.json().result as Json;
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.match(
      result.content[0]?.text ?? '',
      /지시에 주소가 없어요/,
      '기기의 메시지는 관리자의 지시가 아니다',
    );
  });
});
