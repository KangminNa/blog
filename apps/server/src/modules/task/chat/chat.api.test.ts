import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 대화: 관리자만. 상대는 관리자 바로 아래 에이전트. 메시지 하나 = 상대에게 맡긴 작업 하나 (회차).
// 회차가 끝나지 않았을 때 보낸 말은 덧붙인 말이 되고(2차 1-1), 앞 대화는 다음 회차의 payload.chat.history에 자료로 실린다.
// 회차 아래(위임한 하위 작업 포함)의 결과물 · 기다리는 결재가 그 회차에 실린다.

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한을 준 기기 (러너) */
let runner: string;
let worker: OutboxWorker;

/** 일꾼(outbox)이 할 일을 다 한다: 끝난 작업의 소식 */
async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

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
  worker = api.service(OutboxWorker);
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

  test('메시지 하나 = 상대에게 맡긴 작업 하나. 끝나지 않은 회차에는 덧붙이고, 답이 오면 다음 회차에 이전 대화가 실린다', async () => {
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

    const early = ok(await send(chat, '마감일만 먼저'), 201);
    assert.equal(early.turns, 1, '끝나지 않은 회차에 덧붙인 말 (회차는 그대로)');
    const job = await take();
    assert.equal(job.task.id, first.taskId, '대기열의 회차에는 답하는 작업을 따로 만들지 않는다');
    assert.deepEqual(
      job.chat_updates.appended.map((a: Json) => a.text),
      ['마감일만 먼저'],
      '빌릴 때 덧붙인 말을 함께 받는다',
    );
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

  test('회차 아래에서 만든 결과물은 그 회차에, 올린 결재는 결과 카드에 실린다 (2차 2단계)', async () => {
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
    assert.equal(turn.approvalIds.length, 0, '대화의 결재는 회차가 아니라 결과 카드에서 정한다');
    assert.deepEqual(
      turn.outputs.map((o: Json) => o.name),
      ['deck.html'],
    );
    await drain();
    assert.deepEqual(
      (await detail(chat.id)).card.items.map((i: Json) => i.kind),
      ['action', 'output'],
    );
  });

  test('상대를 비우면 기본 대표와 연다. 목표 · 프로젝트(git 주소를 맞춘다)와 함께, 주소가 아니면 422', async () => {
    const lead = await agent('콘솔 대표');
    ok(await api.request('POST', `/api/agents/${lead.id}/lead`, owner, { version: lead.version }));
    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        message: '이번 주 글감 정리해 줘',
        goal: '금요일까지 초안 셋',
        project: 'https://github.com/Me/Blog.git',
      }),
      201,
    );
    assert.deepEqual(
      [chat.agentId, chat.goal, chat.project],
      [lead.id, '금요일까지 초안 셋', 'github.com/me/blog'],
    );
    const bad = await api.request('POST', '/api/chats', owner, {
      requestId: randomUUID(),
      message: '정리',
      project: '그냥 글자',
    });
    assert.equal(bad.status, 422, bad.text);
  });
});

describe('내 컴퓨터의 AI 도구가 서버 팀에 맡기기 (MCP ask_agent · agent_updates, 기기 권한 delegate)', () => {
  test('권한이 없는 기기에는 도구가 보이지 않고, 부르면 delegate 권한을 알린다', async () => {
    const plain = await device(`plain-${randomUUID().slice(0, 6)}`);
    const list = await api.mcp(plain, 'tools/list');
    const names = (list.json().result as Json).tools.map((t: Json) => t.name);
    assert.equal(names.includes('ask_agent') || names.includes('agent_updates'), false);
    const refused = await call(plain, 'ask_agent', { request_id: randomUUID(), message: '검토' });
    assert.deepEqual([refused.ok, refused.body.scope], [false, 'delegate']);
  });

  test('상대를 비우면 기본 대표. 기다리지 않고 소식으로 받는다: 덧붙인 말 · 대표의 짧은 답 · 최종 답, 커서 · 상태판', async () => {
    const lead = await agent('대회 팀장');
    await agent('다른 팀장');
    const mac = await device(`mac-${randomUUID().slice(0, 6)}`, ['delegate']);
    const names = await api.mcp(mac, 'tools/list');
    const tools = (names.json().result as Json).tools.map((t: Json) => t.name);
    assert.ok(tools.includes('ask_agent') && tools.includes('agent_updates'));
    assert.equal(tools.includes('agent_reply'), false, 'agent_reply는 없다 (세션을 묶지 않는다)');
    // 설명 · 칸 설명은 코드가 아니라 설명서(task.tools.ko.json)에서 얹힌다. 형식 · 길이는 코드의 것
    const ask = (names.json().result as Json).tools.find((t: Json) => t.name === 'ask_agent');
    assert.match(ask.description, /에이전트 팀/);
    assert.equal(ask.inputSchema.properties.message.description, '보낼 메시지');
    assert.equal(ask.inputSchema.properties.message.maxLength, 8000);

    // 대표가 없고 상대가 여럿이면 고를 수 있는 이름을 알린다
    await db.sql`UPDATE task.agents SET lead = false WHERE lead`;
    const nobody = await call(mac, 'ask_agent', { request_id: randomUUID(), message: '검토' });
    assert.equal(nobody.ok, false);
    assert.match(nobody.body.message, /기본 대표가 없어요/);
    assert.match(nobody.body.message, new RegExp(lead.name));
    ok(await api.request('POST', `/api/agents/${lead.id}/lead`, owner, { version: lead.version }));

    const requestId = randomUUID();
    const sent = await call(mac, 'ask_agent', {
      request_id: requestId,
      message: '이 분석 검토해 줘\n결론: A안',
      goal: '대회 제출 전에 근거를 보강한다',
      project: 'git@github.com:Owner/Contest.git',
    });
    assert.equal(sent.ok, true, JSON.stringify(sent.body));
    const chatId = sent.body.id;
    assert.deepEqual(
      [sent.body.agentId, sent.body.goal, sent.body.project],
      [lead.id, '대회 제출 전에 근거를 보강한다', 'github.com/owner/contest'],
      '상대를 비우면 기본 대표, 프로젝트는 host/owner/repo로',
    );
    const again = await call(mac, 'ask_agent', { request_id: requestId, message: '같은 말' });
    assert.equal(again.body.id, chatId, '같은 request_id는 같은 대화');
    const bad = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '검토',
      project: '그냥 이름',
    });
    assert.deepEqual([bad.ok, bad.body.code], [false, 'rule_violation']);

    const start = await call(mac, 'agent_updates', { chat_id: chatId });
    assert.deepEqual(start.body.news, [], '아직 소식이 없다');
    const board = start.body.board[0];
    assert.deepEqual(
      [board.chat_id, board.state, board.active, board.project],
      [chatId, 'working', 1, 'github.com/owner/contest'],
    );
    const job = (await jobs()).find((j) => j.task.payload.chat?.chatId === chatId) as Json;
    assert.equal(job.task.payload.chat.via, 'device');

    // 도는 회차에 덧붙이면 소식 한 줄 + 대표가 짧게 답하는 작업 (회차는 그대로)
    const more = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '마감일만 먼저 알려 줘',
      chat_id: chatId,
    });
    assert.deepEqual([more.ok, more.body.turns], [true, 1]);
    const reply = (await jobs()).find((j) => j.task.payload.chat?.reply) as Json;
    assert.equal(reply.task.payload.chat.chatId, chatId);
    assert.equal(reply.instruction, '마감일만 먼저 알려 줘');
    await tool(runner, 'submit_result', {
      task_id: reply.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '마감은 11월 30일이에요' },
    });
    await tool(runner, 'submit_result', {
      task_id: job.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '## 검토\n- 고칠 것: 근거 2' },
    });
    await drain();
    const news = await call(mac, 'agent_updates', { after: start.body.cursor });
    // 끝남 소식은 일꾼이 이벤트를 다루는 순서대로 쌓인다 (짧은 답과 최종 답의 순서는 정해져 있지 않다)
    const kinds = news.body.news.map((n: Json) => [n.kind, n.text.split('\n')[0]]);
    assert.deepEqual(kinds[0], ['appended', '마감일만 먼저 알려 줘']);
    assert.deepEqual(kinds.slice(1).sort(), [
      ['final', '## 검토'],
      ['reply', '마감은 11월 30일이에요'],
    ]);
    const final = news.body.news.find((n: Json) => n.kind === 'final');
    assert.match(final.text, new RegExp(`/admin/chats/${chatId}$`));
    assert.equal(news.body.board.find((b: Json) => b.chat_id === chatId).state, 'done');
    const empty = await call(mac, 'agent_updates', { after: news.body.cursor });
    assert.deepEqual([empty.body.news, empty.body.cursor], [[], news.body.cursor]);
    const ahead = await call(mac, 'agent_updates', { after: news.body.cursor + 1000 });
    assert.deepEqual([ahead.ok, ahead.body.code], [false, 'rule_violation']);

    const { chats } = ok(await api.get('/api/chats', owner));
    assert.ok((chats as Json[]).some((c) => c.id === chatId && c.deviceId === sent.body.deviceId));
    const next = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '고쳤어. 다시 봐 줘',
      chat_id: chatId,
    });
    assert.equal(next.body.turns, 2, '끝난 회차 뒤에는 다음 회차');
  });

  test('대화의 일을 하는 에이전트는 post_update로 소식을 남긴다 (대화 밖의 일은 422). 팀원이 끝나면 소식, 회차는 다음 실행에 팀 소식을 받는다', async () => {
    const boss = await agent('분석 팀장');
    const member = await agent('리서처', { reportsTo: boss.id });
    const mac = await device(`team-${randomUUID().slice(0, 6)}`, ['delegate']);
    const sent = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '대회 요강 정리해 줘',
      agent: boss.name,
    });
    const chatId = sent.body.id;
    const turn = (await jobs()).find((j) => j.task.payload.chat?.chatId === chatId) as Json;
    const start = (await call(mac, 'agent_updates', { chat_id: chatId })).body.cursor;
    const posted = await tool(turn.run_token, 'post_update', {
      kind: 'decision',
      text: '본선 규정을 먼저 본다',
    });
    assert.ok(posted.n > start);
    const wrong = await call(turn.run_token, 'post_update', { kind: 'final', text: '끝' });
    assert.deepEqual([wrong.ok, wrong.body.code], [false, 'rule_violation']);

    await tool(turn.run_token, 'delegate_task', {
      subtasks: [
        {
          request_id: randomUUID(),
          to_agent_id: member.id,
          title: '요강 읽기',
          instruction: '요강을 읽어',
        },
      ],
    });
    const sub = (await jobs()).find((j) => j.task.title === '요강 읽기') as Json;
    await tool(sub.run_token, 'post_update', {
      kind: 'assumption',
      text: '본선은 오프라인이라고 가정',
    });
    // 대화 상세(관리자)의 팀: 상대와 그 아래, 사람마다 이 회차에서 도는 작업
    const busy = await detail(chatId);
    assert.deepEqual(
      busy.team.map((m: Json) => [m.name, m.depth, m.open, m.doing]),
      [
        [boss.name, 0, 1, turn.task.title],
        [member.name, 1, 1, '요강 읽기'],
      ],
    );
    await tool(runner, 'submit_result', {
      task_id: sub.task.id,
      request_id: randomUUID(),
      status: 'done',
      result: { text: '평가 기준 3가지' },
    });
    await drain();
    const news = (await call(mac, 'agent_updates', { chat_id: chatId, after: start })).body.news;
    assert.deepEqual(
      news.map((n: Json) => [n.kind, n.agent, n.text]),
      [
        ['decision', boss.name, '본선 규정을 먼저 본다'],
        ['assumption', member.name, '본선은 오프라인이라고 가정'],
        ['member_done', member.name, '요강 읽기 — 평가 기준 3가지'],
      ],
    );
    const room = await detail(chatId);
    assert.deepEqual([room.state, room.active], ['working', 1], '팀원은 끝났고 회차가 다시 돈다');
    assert.deepEqual(
      room.news.slice(-3).map((n: Json) => [n.kind, n.agent]),
      news.map((n: Json) => [n.kind, n.agent]),
      '상세의 소식은 agent_updates와 같다',
    );
    assert.deepEqual(
      room.team.map((m: Json) => [m.name, m.open, m.doing]),
      [
        [boss.name, 1, turn.task.title],
        [member.name, 0, null],
      ],
    );
    const woken = (await jobs()).find((j) => j.task.id === turn.task.id) as Json;
    assert.deepEqual(
      woken.chat_updates.team.map((t: Json) => [t.kind, t.text]),
      [['assumption', '본선은 오프라인이라고 가정']],
      '깨어난 회차는 팀원이 남긴 소식을 자료로 받는다',
    );

    const outside = ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: member.id,
        kind: 'general',
        instruction: '대화 밖의 일',
      }),
      201,
    );
    const loose = (await jobs()).find((j) => j.task.id === outside.id) as Json;
    const refused = await call(loose.run_token, 'post_update', { kind: 'progress', text: '중간' });
    assert.deepEqual([refused.ok, refused.body.code], [false, 'rule_violation']);
  });

  test('소식 기기(news, cairn connect의 훅 · 상태 줄)는 모든 대화의 소식을 읽기만 한다', async () => {
    const partner = await agent('소식 팀장');
    const mac = await device(`n-mac-${randomUUID().slice(0, 6)}`, ['delegate']);
    const hook = await api.connectDevice(owner, `n-hook-${randomUUID().slice(0, 6)}`, 'news');
    const list = await api.mcp(hook, 'tools/list');
    const names = (list.json().result as Json).tools.map((t: Json) => t.name);
    assert.deepEqual(names, ['agent_updates'], '소식 기기에는 agent_updates 하나만');
    const refused = await call(hook, 'ask_agent', { request_id: randomUUID(), message: '몰래' });
    assert.deepEqual([refused.ok, refused.body.scope], [false, 'delegate']);

    const start = (await call(hook, 'agent_updates', {})).body.cursor;
    const fromMac = await call(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: '기기에서 맡김',
      agent: partner.id,
      project: 'git@github.com:Me/Repo.git',
    });
    const fromOwner = ok(await open(partner.id, '관리자가 맡김'), 201);
    const seen = (await call(hook, 'agent_updates', { after: start })).body;
    const boards = seen.board.map((b: Json) => b.chat_id);
    assert.ok(
      boards.includes(fromMac.body.id) && boards.includes(fromOwner.id),
      '모든 대화가 보인다',
    );
    const only = (await call(hook, 'agent_updates', { project: 'github.com/me/repo' })).body;
    assert.deepEqual(
      only.board.map((b: Json) => b.chat_id),
      [fromMac.body.id],
      '프로젝트로 거른다',
    );
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
    const res = await call(other, 'ask_agent', {
      request_id: randomUUID(),
      message: '끼어들기',
      chat_id: chatId,
    });
    assert.deepEqual([res.ok, res.body.code], [false, 'not_found']);
    const seen = await call(other, 'agent_updates', { chat_id: chatId });
    assert.deepEqual(seen.body.board, [], '남의 대화는 상태판에도 없다');
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
