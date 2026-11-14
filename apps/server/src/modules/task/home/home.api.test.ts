import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// 홈 (2차 1-1): 관리자만. 팀(관리자 바로 아래 에이전트, 기본 대표가 먼저) · 대화의 상태판 · 최근 결과물 · 기다리는 결재 수

// biome-ignore lint/suspicious/noExplicitAny: 응답 JSON을 여러 겹 읽는 시험 (모양은 assert가 본다)
type Json = Record<string, any>;

let api: ApiClient;
let owner: TestUser;
let db: Database;

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
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

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
});
after(() => api.close());

describe('홈', () => {
  test('방문자 · write 기기는 403', async () => {
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `home-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer]) {
      const res = await api.request('GET', '/api/home', TestUser.visitor, undefined, headers);
      assert.equal(res.status, 403, res.text);
    }
  });

  test('팀은 기본 대표가 먼저, 아래 에이전트 수와 도는 작업 수. 대화는 상태판, 결과물 · 결재 수', async () => {
    const lead = await agent('홈 대표');
    ok(await api.request('POST', `/api/agents/${lead.id}/lead`, owner, { version: lead.version }));
    const other = await agent('가 다른 팀장');
    const member = await agent('홈 팀원', { reportsTo: lead.id });
    const gone = await agent('지운 팀원', { reportsTo: lead.id });
    ok(
      await api.request('POST', `/api/agents/${gone.id}/delete`, owner, { version: gone.version }),
    );

    const chat = ok(
      await api.request('POST', '/api/chats', owner, {
        requestId: randomUUID(),
        agentId: lead.id,
        message: '경쟁사 세 곳 비교해 줘',
      }),
      201,
    );
    const home = ok(await api.get('/api/home', owner));
    const team = home.team.filter((a: Json) => [lead.id, other.id, member.id].includes(a.id));
    assert.deepEqual(
      team.map((a: Json) => [a.id, a.lead, a.members, a.open]),
      [
        [lead.id, true, 1, 1],
        [other.id, false, 0, 0],
      ],
      '대표가 먼저, 팀원 · 지운 에이전트는 팀 줄에 없다',
    );
    const row = home.chats.find((c: Json) => c.id === chat.id);
    assert.deepEqual(
      [row?.state, row?.active, row?.partner, row?.turns],
      ['working', 1, lead.name, 1],
    );

    const [counts] = await db.sql<{ outputs: number; approvals: number }[]>`
      SELECT (SELECT count(*)::int FROM task.outputs WHERE deleted_at IS NULL) AS outputs,
        (SELECT count(*)::int FROM task.approvals WHERE status = 'pending') AS approvals`;
    assert.equal(home.outputs.length, Math.min(counts?.outputs ?? 0, 12));
    assert.equal(home.pendingApprovals, counts?.approvals);
  });
});
