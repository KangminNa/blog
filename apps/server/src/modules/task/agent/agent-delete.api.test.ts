import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// 에이전트 삭제 (휴지통): 행은 남기고 목록 · 조직도 · 새 일에서 뺀다. 팀원은 위로 올리거나 팀째 지운다.
// 진행 중인 작업 · 스케줄 · 도는 목표 실행이 있으면 지우지 않고 까닭을 알린다. 복원하면 다시 쓴다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};

const agent = async (name: string, reportsTo: unknown = null) =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `${name} ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
      reportsTo,
    }),
    201,
  );
const current = async (id: unknown) => {
  const all = [
    ...(ok(await api.get('/api/agents', owner)).agents as Json[]),
    ...(ok(await api.get('/api/agents?deleted=1', owner)).agents as Json[]),
  ];
  return all.find((a) => a.id === id) as Json;
};
const remove = async (a: Json, team = false) =>
  api.request('POST', `/api/agents/${a.id}/delete`, owner, {
    version: (await current(a.id)).version,
    team,
  });
const listed = async (query = '') =>
  (ok(await api.get(`/api/agents${query}`, owner)).agents as Json[]).map((a) => a.id);

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(() => api.close());

describe('에이전트 삭제', () => {
  test('방문자 · write 기기는 지우거나 되돌리지 못한다 (403)', async () => {
    const a = await agent('남의 것');
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `del-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer])
      for (const path of ['delete', 'restore']) {
        const res = await api.request(
          'POST',
          `/api/agents/${a.id}/${path}`,
          TestUser.visitor,
          { version: a.version },
          headers,
        );
        assert.equal(res.status, 403, res.text);
      }
  });

  test('지우면 목록에서 빠지고 휴지통에 보인다. 팀원은 지운 에이전트의 보고 대상으로 올라간다. 복원하면 돌아온다', async () => {
    const boss = await agent('본부장');
    const lead = await agent('팀장', boss.id);
    const member = await agent('팀원', lead.id);
    const res = ok(await remove(lead));
    assert.ok(res.deletedAt);
    assert.ok(!(await listed()).includes(lead.id));
    assert.ok((await listed('?deleted=1')).includes(lead.id));
    assert.equal((await current(member.id)).reportsTo, boss.id, '팀원은 위로');
    assert.equal((await remove(lead)).status, 404, '이미 지운 것');

    // 지운 에이전트는 새 일 · 보고 대상 · 목표 실행에서 없는 것과 같다
    const task = await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: lead.id,
      instruction: '지운 에이전트에게',
    });
    assert.equal(task.status, 404, task.text);
    const moved = await api.request('PATCH', `/api/agents/${member.id}`, owner, {
      version: (await current(member.id)).version,
      reportsTo: lead.id,
    });
    assert.equal(moved.status, 422, moved.text);

    const back = ok(
      await api.request('POST', `/api/agents/${lead.id}/restore`, owner, {
        version: (await current(lead.id)).version,
      }),
    );
    assert.deepEqual([back.deletedAt, back.reportsTo], [null, boss.id]);
    assert.ok((await listed()).includes(lead.id));
  });

  test('팀째 지우면 아래 팀 전체가 휴지통으로. 보고 대상이 지워진 뒤 복원하면 관리자 아래로', async () => {
    const lead = await agent('팀장');
    const a = await agent('팀원 가', lead.id);
    const b = await agent('팀원 나', a.id);
    ok(await remove(lead, true));
    const trash = await listed('?deleted=1');
    for (const x of [lead, a, b]) assert.ok(trash.includes(x.id), String(x.name));
    const restored = ok(
      await api.request('POST', `/api/agents/${b.id}/restore`, owner, {
        version: (await current(b.id)).version,
      }),
    );
    assert.equal(restored.reportsTo, null, '보고 대상(팀원 가)이 휴지통이라 관리자 아래로');
  });

  test('진행 중인 작업 · 스케줄 · 도는 목표 실행이 있으면 지우지 않고 까닭을 알린다 (422)', async () => {
    const busy = await agent('바쁜');
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: busy.id,
        instruction: '하는 중',
      }),
      201,
    );
    const refused = await remove(busy);
    assert.equal(refused.status, 422, refused.text);
    assert.match(refused.text, /진행 중인 작업 1개/);

    const scheduled = await agent('스케줄 담당');
    ok(
      await api.request('POST', '/api/schedules', owner, {
        requestId: randomUUID(),
        agentId: scheduled.id,
        title: '매일 확인',
        enabled: true,
        mode: 'daily',
        atTime: '09:30',
        timeZone: 'Asia/Seoul',
        instruction: '확인',
        dailyMax: 1,
      }),
      201,
    );
    const blocked = await remove(scheduled);
    assert.equal(blocked.status, 422, blocked.text);
    assert.match(blocked.text, /스케줄 1개/);
    assert.ok((await listed()).includes(scheduled.id), '지우지 않았다');
  });
});
