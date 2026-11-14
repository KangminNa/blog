import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, type TestUser } from '../../../testing/api-client';
import { Database, OutboxWorker } from '../../platform';

// 나를 기다리는 것 (MCP inbox, 2차 4단계): 브라우저 확장의 배지. 권한 inbox가 있는 기기만.
// 결재 화면 목록과 같은 결재(대화의 결재는 빼고 결과 카드는 대화로)와, 맡을 에이전트를 묻는 대화의 질문

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
let reader: string;
let plain: string;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function inbox(token: string): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name: 'inbox', arguments: {} });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as Json;
  return result.isError ? { ok: false } : { ok: true, ...result.structuredContent };
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  ok(
    await api.request('PUT', '/api/space', owner, { name: '배지', siteUrl: api.baseUrl, version }),
  );
  plain = await api.connectDevice(owner, 'inbox-plain');
  reader = await api.connectDevice(owner, 'inbox-reader');
  const devices = ok(await api.get('/api/devices', owner)).devices as Json[];
  const device = devices.find((d) => d.name === 'inbox-reader') as Json;
  ok(
    await api.request('PATCH', `/api/devices/${device.id}`, owner, {
      scopes: ['upload', 'inbox'],
      version: device.version,
    }),
  );
});
after(async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  await api.close();
});

describe('inbox', () => {
  test('권한 inbox가 없으면 부르지 못한다', async () => {
    assert.equal((await inbox(plain)).ok, false);
  });

  test('기다리는 결재(대화의 결재는 빼고)와 맡을 에이전트를 묻는 질문의 수 · 최근 것 · 콘솔 주소', async () => {
    const spaceId = String(
      (await db.sql<{ id: string }[]>`SELECT id FROM account.spaces LIMIT 1`)[0]?.id,
    );
    const before = await inbox(reader);
    const approvalId = randomUUID();
    const inChat = randomUUID();
    const chatId = randomUUID();
    await db.sql`
      INSERT INTO task.chats (id, space_id, title, request_id, pending)
      VALUES (${chatId}, ${spaceId}, '어디에 맡길까', ${randomUUID()}, '산책 글 써 줘')`;
    await db.sql`
      INSERT INTO task.chat_updates (id, space_id, chat_id, kind, text)
      VALUES (${randomUUID()}, ${spaceId}, ${chatId}, 'question', '어느 에이전트에게 맡길까요?')`;
    await db.sql`
      INSERT INTO task.approvals (id, space_id, action, target_kind, target_id, target_version, note, chat_id)
      VALUES (${approvalId}, ${spaceId}, 'blog.post.publish', 'post', ${randomUUID()}, 1, '공개해도 될까요', NULL),
             (${inChat}, ${spaceId}, 'blog.post.publish', 'post', ${randomUUID()}, 1, '대화 안', ${chatId})`;

    const got = await inbox(reader);
    assert.equal(got.approvals.count, before.approvals.count + 1, '대화의 결재는 세지 않는다');
    assert.equal(got.questions.count, before.questions.count + 1);
    assert.equal(got.total, got.approvals.count + got.questions.count);
    const approval = (got.approvals.items as Json[]).find((a) => a.id === approvalId);
    assert.deepEqual(
      [approval?.title, approval?.link],
      ['공개해도 될까요', `/admin/approvals/${approvalId}`],
    );
    assert.ok(!(got.approvals.items as Json[]).some((a) => a.id === inChat));
    const question = (got.questions.items as Json[]).find((q) => q.chat_id === chatId);
    assert.deepEqual(
      [question?.question, question?.link],
      ['어느 에이전트에게 맡길까요?', `/admin/chats/${chatId}`],
    );
  });
});
