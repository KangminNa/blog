import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker, SystemActor } from '../../platform';
import { ChatRouteService } from './chat-route.service';

// 배정 (2차 1-5 · 기획서 결정 2026-11-14): 상대 없이 보내면 맡는 일이 맞는 에이전트가 맡는다.
// 후보가 여럿이면 배정 일(에이전트 없이 러너가 지시 하나를 돌린다)의 답(JSON)으로 맡기거나 묻고, 1분 넘게 아무도 빌려 가지 않으면 서버가 묻는다.
// 질문에는 고르거나(choice · 번호 · 이름) 글로 답한다. 같은 일이 MCP ask_agent로도 열린다 (질문은 agent_updates로).
// 시험 DB의 공간은 다른 시험과 함께 쓰여서 후보는 늘 여럿이다 (후보가 하나 · 없을 때는 ChatRoute 단위 시험)

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let runner: string;
let blog: Json;
let research: Json;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function tool(token: string, name: string, args: Json = {}): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError
    ? { ok: false, ...JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, ...(result.structuredContent ?? {}) };
}

const drain = async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};
const agent = async (name: string, role: string, more: Json = {}) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      role,
      tool: 'claude',
      scopes: ['read_public'],
      ...more,
    }),
    201,
  );
const detail = async (id: string) => ok(await api.get(`/api/chats/${id}`, owner));
const notices = async (): Promise<Json[]> =>
  ok(await api.get('/api/notifications', owner)).notifications as Json[];
const open = async (message: string) =>
  ok(await api.request('POST', '/api/chats', owner, { requestId: randomUUID(), message }), 201);
const answer = (chat: Json, message: string, choice?: string) =>
  api.request('POST', `/api/chats/${chat.id}/messages`, owner, {
    requestId: randomUUID(),
    version: chat.version,
    message,
    ...(choice ? { choice } : {}),
  });

/** 러너가 일을 빌린다. 제목에 표시가 있는 일이 올 때까지 (같은 DB의 다른 일이 먼저 올 수 있다) */
async function leased(mark: string, kind: string): Promise<Json> {
  for (let round = 0; round < 20; round++) {
    const next = await tool(runner, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
      own_logins: ['claude'],
    });
    const job = (next.jobs as Json[]).find(
      (j) => j.task.kind === kind && String(j.task.title).includes(mark),
    );
    if (job) return job;
  }
  throw new Error(`빌린 일이 없다: ${kind} ${mark}`);
}

const submit = (job: Json, text: string) =>
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
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '배정', siteUrl: api.baseUrl, version });
  const made = ok(
    await api.request('POST', '/api/devices/runner', owner, {
      requestId: randomUUID(),
      name: '배정 러너',
    }),
    201,
  );
  runner = String(made.token);
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  blog = await agent('블로그 팀', '글을 쓰고 블로그에 올려요\n자세한 규칙');
  research = await agent('리서치 팀', '공개 자료를 찾아 출처와 함께 정리해요');
});
after(() => api.close());

/** 이 시험의 일만 빌려 가게 앞 시험이 남긴 일을 치운다 */
beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

describe('배정', () => {
  test('후보가 여럿이면 배정 일 하나. 고른 답(JSON)으로 맡고 첫 회차가 그 메시지로 열린다 (받을 것도 함께)', async () => {
    const mark = randomUUID().slice(0, 8);
    const chat = await open(`산책 글 써서 올려 줘 ${mark}`);
    assert.deepEqual(
      [chat.agentId, chat.pending, chat.turns],
      [null, `산책 글 써서 올려 줘 ${mark}`, 0],
    );
    const listed = ok(await api.get('/api/chats', owner)).chats as Json[];
    const row = listed.find((c) => c.id === chat.id);
    assert.deepEqual([row?.state, row?.agentName], ['routing', null]);

    const job = await leased(mark, 'chat_route');
    assert.equal(job.task.agent_id ?? null, null, '에이전트 없이 돈다');
    assert.match(
      job.instruction,
      new RegExp(`${blog.id} · ${blog.name}: 글을 쓰고 블로그에 올려요`),
    );
    assert.match(job.instruction, new RegExp(mark));
    assert.doesNotMatch(job.instruction, /자세한 규칙/, '맡는 일은 역할의 첫 줄만');
    const done = await submit(
      job,
      `골랐어요\n{"agent":"${blog.id}","reason":"블로그 글이에요","deliver":"blog"}`,
    );
    assert.equal(done.ok, true, JSON.stringify(done));
    await drain();

    const got = await detail(chat.id);
    assert.deepEqual(
      [got.chat.agentId, got.chat.pending, got.chat.deliver, got.chat.turns, got.question],
      [blog.id, null, 'blog', 1, null],
    );
    assert.equal(got.turns[0].message, `산책 글 써서 올려 줘 ${mark}`);
    const routed = got.news.find((n: Json) => n.kind === 'routed');
    assert.deepEqual([routed?.text, routed?.agent], ['블로그 글이에요', blog.name]);
    const turn = await leased(mark, 'general');
    assert.equal(turn.task.payload.chat.chatId, chat.id);

    // 회차의 답이 오면 알림 (알림 센터 + 웹 푸시, 2차 1-5)
    await submit(turn, '초안을 썼어요');
    await drain();
    const answered = (await notices()).find(
      (n) => n.kind === 'task.chat.answered' && n.link === `/admin/chats/${chat.id}`,
    );
    assert.equal(answered?.title, `답이 왔어요 · 산책 글 써서 올려 줘 ${mark}`);
    assert.match(answered?.body ?? '', /^초안을 썼어요/);
  });

  test('애매하면 묻는다: 고를 것과 함께. 글로 한 답은 다시 배정하고 첫 회차에 덧붙인 말로, 고르면 맡는다', async () => {
    const mark = randomUUID().slice(0, 8);
    const chat = await open(`이번 주 정리 ${mark}`);
    const first = await leased(mark, 'chat_route');
    await submit(
      first,
      `{"question":"글로 할까요, 조사로 할까요?","choices":["${blog.id}","${research.id}"]}`,
    );
    await drain();
    let got = await detail(chat.id);
    assert.equal(got.state, 'asking');
    const asked = () =>
      notices().then((all) =>
        all.find((n) => n.kind === 'task.chat.asked' && n.link === `/admin/chats/${chat.id}`),
      );
    assert.deepEqual(
      [(await asked())?.body, (await asked())?.read],
      ['글로 할까요, 조사로 할까요?', false],
      '질문은 알림으로 (웹 푸시까지)',
    );
    assert.equal(got.question.text, '글로 할까요, 조사로 할까요?');
    assert.deepEqual(
      got.question.choices.map((c: Json) => [c.id, c.name, c.role]),
      [
        [blog.id, blog.name, '글을 쓰고 블로그에 올려요'],
        [research.id, research.name, '공개 자료를 찾아 출처와 함께 정리해요'],
      ],
    );

    // 고를 것을 가리키지 않는 말: 답으로 남기고 다시 배정한다 (배정 일이 그 답을 본다)
    ok(await answer(got.chat, '사진은 빼고 해 줘'), 201);
    got = await detail(chat.id);
    assert.equal(got.state, 'routing');
    const second = await leased(mark, 'chat_route');
    assert.match(second.instruction, /사진은 빼고 해 줘/);
    await submit(second, '모르겠어요');
    await drain();
    got = await detail(chat.id);
    assert.equal(got.question.text, '어느 에이전트에게 맡길까요?', '읽지 못한 답은 서버의 질문');
    assert.ok(got.question.choices.length >= 2);

    const member = await agent('팀원', '돕는다', { reportsTo: blog.id });
    const wrong = await answer(got.chat, member.name, member.id);
    assert.equal(wrong.status, 422, '후보가 아닌 에이전트는 고르지 못한다');
    const visitor = await api.request('POST', `/api/chats/${chat.id}/messages`, TestUser.visitor, {
      requestId: randomUUID(),
      version: got.chat.version,
      message: 'x',
      choice: blog.id,
    });
    assert.equal(visitor.status, 403);
    ok(await answer(got.chat, research.name, research.id), 201);
    await drain();
    assert.ok(
      (await notices())
        .filter((n) => n.kind === 'task.chat.asked' && n.link === `/admin/chats/${chat.id}`)
        .every((n) => n.read),
      '맡으면 질문 알림은 읽음으로',
    );
    got = await detail(chat.id);
    assert.deepEqual([got.chat.agentId, got.chat.turns, got.question], [research.id, 1, null]);
    const turn = await leased(mark, 'general');
    assert.deepEqual(
      turn.chat_updates.appended.map((a: Json) => a.text),
      ['사진은 빼고 해 줘'],
      '맡기 전의 답은 첫 회차에 덧붙인 말로 간다',
    );
  });

  test('1분 넘게 아무도 빌려 가지 않으면 서버가 묻는다. 멈추면 배정 일도 취소된다', async () => {
    const mark = randomUUID().slice(0, 8);
    const late = await open(`늦은 배정 ${mark}`);
    const routes = api.service(ChatRouteService);
    assert.equal(await routes.overdue(new SystemActor()), 0, '아직 1분이 안 됐다');
    const soon = new Date(Date.now() + 2 * 60_000);
    assert.ok((await routes.overdue(new SystemActor(), soon)) >= 1);
    const got = await detail(late.id);
    assert.deepEqual([got.state, got.question?.text], ['asking', '어느 에이전트에게 맡길까요?']);
    const [cancelled] = await db.sql<{ status: string }[]>`
      SELECT status FROM task.tasks WHERE request_id LIKE ${`chat-route:${late.id}:%`}`;
    assert.equal(cancelled?.status, 'cancelled');
    assert.equal(await routes.overdue(new SystemActor(), soon), 0, '두 번 묻지 않는다');

    const stopped = await open(`멈출 배정 ${mark}`);
    ok(
      await api.request('POST', `/api/chats/${stopped.id}/stop`, owner, {
        version: stopped.version,
      }),
    );
    const [route] = await db.sql<{ status: string }[]>`
      SELECT status FROM task.tasks WHERE request_id LIKE ${`chat-route:${stopped.id}:%`}`;
    assert.equal(route?.status, 'cancelled');
  });
});

describe('배정 (MCP ask_agent)', () => {
  test('상대를 비우면 배정. 질문은 agent_updates에 고를 것과 함께 오고, 번호로 답하면 맡는다', async () => {
    const mac = await api.connectDevice(owner, `route-mac-${randomUUID().slice(0, 6)}`);
    const { devices } = ok(await api.get('/api/devices', owner)) as { devices: Json[] };
    const device = devices.find((d) => d.name.startsWith('route-mac-')) as Json;
    ok(
      await api.request('PATCH', `/api/devices/${device.id}`, owner, {
        scopes: [...device.scopes, 'delegate'],
        version: device.version,
      }),
    );
    const mark = randomUUID().slice(0, 8);
    const sent = await tool(mac, 'ask_agent', {
      request_id: randomUUID(),
      message: `경쟁사 가격 비교 ${mark}`,
    });
    assert.deepEqual([sent.ok, sent.agentId], [true, null]);
    const job = await leased(mark, 'chat_route');
    await submit(
      job,
      `{"question":"어느 팀에 맡길까요?","choices":["${research.id}","${blog.id}"]}`,
    );
    await drain();

    const news = await tool(mac, 'agent_updates', { chat_id: sent.id });
    const asked = (news.news as Json[]).find((n) => n.kind === 'question');
    assert.equal(asked?.text, '어느 팀에 맡길까요?');
    assert.deepEqual(
      asked?.choices.map((c: Json) => c.id),
      [research.id, blog.id],
    );
    assert.equal(news.board[0].state, 'asking');
    const picked = await tool(mac, 'ask_agent', {
      request_id: randomUUID(),
      chat_id: sent.id,
      message: '1번',
    });
    assert.deepEqual([picked.ok, picked.agentId, picked.turns], [true, research.id, 1]);
  });
});
