import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// 알림 설정(/api/notice-settings)과 모듈이 등록한 알림 종류 (7단계).
// 보는 사람별(방문자 · write 기기 · 주인)과, 이벤트에서 알림이 생기고 · 끝난 일의 알림이 읽음이 되고 · 끈 종류는 남지 않는 흐름.

type Json = Record<string, unknown>;
type Notice = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  read: boolean;
};

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'notice-writer')}` };
  // MCP는 사이트 주소가 있어야 연다 (다른 시험 파일이 먼저 바꿔 두었을 수 있다)
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '알림',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
});
after(() => api.close());

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const settings = async () => ok(await api.get('/api/notice-settings', owner));
const put = (body: Json, as = owner, headers: Record<string, string> = {}) =>
  api.request('PUT', '/api/notice-settings', as, body, headers);
const BASE = { digest: 'hourly', digestTime: '09:00', timeZone: 'Asia/Seoul', routes: {} };

async function notices(kind: string): Promise<Notice[]> {
  const { notifications } = ok(await api.get('/api/notifications', owner)) as unknown as {
    notifications: Notice[];
  };
  return notifications.filter((n) => n.kind === kind);
}

const newDevice = async (name: string) =>
  ok(
    await api.request('POST', '/api/devices/runner', owner, { requestId: randomUUID(), name }),
    201,
  );

async function tool(token: string, name: string, args: Json): Promise<Json> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  const result = res.json().result as { isError?: boolean; structuredContent?: Json };
  assert.ok(!result.isError, res.text);
  return result.structuredContent ?? {};
}

describe('알림 설정 (/api/notice-settings)', () => {
  test('방문자와 write 기기는 보지도 바꾸지도 못한다 (403)', async () => {
    for (const headers of [{}, writer]) {
      const read = await api.request(
        'GET',
        '/api/notice-settings',
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(read.status, 403, read.text);
      assert.equal((await put({ ...BASE, version: 0 }, TestUser.visitor, headers)).status, 403);
    }
  });

  test('처음에는 기본값: 한 시간 묶음, 조용한 시간 없음, 등록한 종류마다 등급의 기본 경로', async () => {
    const got = await settings();
    assert.equal(got.digest, 'hourly');
    assert.equal(got.quietStart, null);
    const kinds = got.kinds as { kind: string; severity: string; route: string; label: string }[];
    const of = (kind: string) => kinds.find((k) => k.kind === kind);
    for (const kind of ['task.approval.requested', 'task.task.failed', 'account.device.connected'])
      assert.deepEqual([of(kind)?.severity, of(kind)?.route], ['immediate', 'push'], kind);
    for (const kind of ['vault.change.review', 'vault.session.saved', 'vault.wiki.stale'])
      assert.deepEqual([of(kind)?.severity, of(kind)?.route], ['digest', 'push'], kind);
    assert.deepEqual(
      [of('task.schedule.skipped')?.severity, of('task.schedule.skipped')?.route],
      ['log', 'center'],
    );
    assert.equal(of('task.approval.requested')?.label, '결재 요청');
  });

  test('저장 · version · 모양과 뜻의 검사', async () => {
    const before = await settings();
    const saved = ok(
      await put({
        ...BASE,
        digest: 'daily',
        digestTime: '08:30',
        quietStart: '23:00',
        quietEnd: '07:00',
        routes: { 'vault.session.saved': 'center' },
        version: before.version,
      }),
    );
    assert.deepEqual(
      [saved.digest, saved.digestTime, saved.quietStart, saved.quietEnd],
      ['daily', '08:30', '23:00', '07:00'],
    );
    const session = (saved.kinds as Json[]).find((k) => k.kind === 'vault.session.saved');
    assert.equal(session?.route, 'center');
    assert.equal((await put({ ...BASE, version: before.version })).status, 409, '늦은 쓰기');
    const v = saved.version;
    assert.equal((await put({ ...BASE, digestTime: '9시', version: v })).status, 400);
    assert.equal((await put({ ...BASE, digest: 'weekly', version: v })).status, 422);
    assert.equal((await put({ ...BASE, quietStart: '23:00', version: v })).status, 422);
    assert.equal((await put({ ...BASE, timeZone: 'Mars/Base', version: v })).status, 422);
    assert.equal(
      (await put({ ...BASE, routes: { 'no.such.kind': 'push' }, version: v })).status,
      422,
    );
    assert.equal(
      (await put({ ...BASE, routes: { 'task.task.failed': 'email' }, version: v })).status,
      422,
    );
    ok(await put({ ...BASE, version: v }));
  });
});

describe('모듈이 등록한 알림', () => {
  test('새 기기를 연결하면 즉시 알림. 그 종류를 끄면 남지 않는다', async () => {
    // 목록은 최근 30개라 개수로 세지 않는다 (앞 시험이 쌓은 알림이 밀려난다). 이번 기기 이름으로 찾는다
    const named = async (name: string) =>
      (await notices('account.device.connected')).filter((n) => String(n.body).includes(name));
    const first = `알림 기기 ${randomUUID().slice(0, 8)}`;
    await newDevice(first);
    const [made, ...more] = await named(first);
    assert.equal(more.length, 0);
    assert.equal(made?.title, '새 기기를 연결했어요');
    assert.equal(made?.severity, 'immediate');

    const now = await settings();
    ok(await put({ ...BASE, routes: { 'account.device.connected': 'off' }, version: now.version }));
    const second = `알림 기기 ${randomUUID().slice(0, 8)}`;
    await newDevice(second);
    assert.deepEqual(await named(second), [], '끈 종류');
    const after = await settings();
    ok(await put({ ...BASE, version: after.version }));
  });

  test('결재를 올리면 즉시 알림, 결재가 끝나면 그 알림은 읽음. 작업이 실패하면 즉시 알림', async () => {
    const runner = String((await newDevice('알림 러너')).token);
    ok(
      await api.request('PUT', '/api/ai/claude/token', owner, {
        token: `sk-ant-oat01-${randomUUID()}`,
      }),
    );
    const agent = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: '알림 시험',
        tool: 'claude',
        approvalActions: ['blog.post.publish'],
      }),
      201,
    );
    const task = ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: agent.id,
        instruction: `알림 시험 ${randomUUID()}`,
      }),
      201,
    );
    let job: Json | undefined;
    for (let round = 0; round < 20 && !job; round++) {
      const { jobs } = (await tool(runner, 'next_jobs', {
        wait_seconds: 0,
        limit: 10,
        tools: ['claude'],
      })) as {
        jobs: Json[];
      };
      job = jobs.find((j) => (j.task as Json).id === task.id);
      if (jobs.length === 0) break;
    }
    assert.ok(job, '빌린 일이 없다');
    const approval = await tool(String(job.run_token), 'request_approval', {
      request_id: randomUUID(),
      action: 'blog.post.publish',
      target_kind: 'post',
      target_id: randomUUID(),
      target_version: 1,
      note: '공개해 주세요',
    });
    const [asked] = (await notices('task.approval.requested')).filter((n) =>
      String(n.body).startsWith('공개해 주세요'),
    );
    assert.equal(asked?.title, '결재를 기다려요');
    assert.equal(asked?.read, false);

    const detail = ok(await api.get(`/api/approvals/${approval.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${detail.id}/decide`, owner, {
        version: detail.version,
        decision: 'reject',
        note: '아직',
      }),
    );
    const settled = (await notices('task.approval.requested')).find((n) => n.id === asked?.id);
    assert.equal(settled?.read, true, '결재가 끝나면 읽음');

    // 거절하면 그 작업은 취소된다. 다른 작업을 러너가 실패로 끝내면 즉시 알림
    const second = ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: agent.id,
        instruction: `실패 시험 ${randomUUID()}`,
      }),
      201,
    );
    let leased = false;
    for (let round = 0; round < 20 && !leased; round++) {
      const { jobs } = (await tool(runner, 'next_jobs', {
        wait_seconds: 0,
        limit: 10,
        tools: ['claude'],
      })) as { jobs: Json[] };
      leased = jobs.some((j) => (j.task as Json).id === second.id);
      if (jobs.length === 0) break;
    }
    assert.ok(leased, '둘째 일을 빌리지 못했다');
    await tool(runner, 'submit_result', {
      task_id: second.id,
      request_id: randomUUID(),
      status: 'failed',
      error: '모델에 닿지 못했어요',
    });
    const failed = (await notices('task.task.failed')).find((n) =>
      n.title.includes(String(second.title)),
    );
    assert.ok(failed, '실패 알림');
    assert.match(String(failed?.body), /모델에 닿지 못했어요/);
  });
});
