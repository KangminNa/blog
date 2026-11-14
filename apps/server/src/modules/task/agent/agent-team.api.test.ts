import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';

// 에이전트 팀 템플릿: 관리자만 보고 만든다. 팀 하나가 한 번에 (역할 · 권한 · 조직도), 같은 requestId는 처음 만든 팀.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};

const make = (team: string, more: Json = {}) =>
  api.request('POST', '/api/agent-teams', owner, { requestId: randomUUID(), team, ...more });

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
});
after(() => api.close());

describe('에이전트 팀 템플릿', () => {
  test('방문자 · write 기기는 보지도 만들지도 못한다 (403)', async () => {
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `team-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    for (const headers of [{}, writer]) {
      const read = await api.request(
        'GET',
        '/api/agent-teams',
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(read.status, 403, read.text);
      const made = await api.request(
        'POST',
        '/api/agent-teams',
        TestUser.visitor,
        { requestId: randomUUID(), team: 'contest' },
        headers,
      );
      assert.equal(made.status, 403, made.text);
    }
  });

  test('목록: 템플릿마다 구성원(역할 · 권한 · 보고 대상)과 필요한 것', async () => {
    const { teams } = ok(await api.get('/api/agent-teams', owner)) as { teams: Json[] };
    assert.deepEqual(
      teams.map((t) => t.key),
      ['contest', 'briefing', 'planning', 'data', 'blog', 'code'],
    );
    const contest = teams[0] as { needs: string[]; members: Json[] };
    assert.deepEqual(contest.needs, ['code-runner']);
    assert.deepEqual(
      contest.members.map((m) => [m.name, m.reportsTo]),
      [
        ['대회 팀장', null],
        ['대회 리서처', 'lead'],
        ['대회 분석가', 'lead'],
        ['대회 검토자', 'lead'],
        ['대회 제작자', null],
      ],
    );
    for (const team of teams)
      for (const m of team.members as Json[]) assert.ok(String(m.role).length > 20, String(m.name));
  });

  test('대회 팀: 한 번에 다섯, 팀장 아래 셋 · 제작자는 관리자 아래. 같은 requestId는 처음 만든 팀', async () => {
    const requestId = randomUUID();
    const first = ok(
      await api.request('POST', '/api/agent-teams', owner, { requestId, team: 'contest' }),
      201,
    ).agents as Json[];
    assert.equal(first.length, 5);
    const lead = first[0] as Json;
    assert.deepEqual([lead.name, lead.reportsTo, lead.tool], ['대회 팀장', null, 'claude']);
    for (const m of first.slice(1, 4)) assert.equal(m.reportsTo, lead.id, String(m.name));
    const maker = first[4] as Json;
    assert.deepEqual([maker.name, maker.reportsTo, maker.scopes], ['대회 제작자', null, ['make']]);
    assert.deepEqual(lead.scopes, ['read_public'], '조사하는 에이전트는 공개 읽기만');

    const count = async () =>
      ((ok(await api.get('/api/agents', owner)).agents as Json[]) ?? []).length;
    const before = await count();
    const again = ok(
      await api.request('POST', '/api/agent-teams', owner, { requestId, team: 'contest' }),
      201,
    ).agents as Json[];
    assert.deepEqual(
      again.map((a) => a.id),
      first.map((a) => a.id),
    );
    assert.equal(await count(), before, '다시 보내도 팀은 하나');
  });

  test('모든 템플릿이 에이전트 규칙(권한 조합 · 조직도)을 지나 만들어진다. 도구를 고를 수 있다', async () => {
    const { teams } = ok(await api.get('/api/agent-teams', owner)) as { teams: Json[] };
    for (const team of teams) {
      const made = ok(await make(String(team.key), { tool: 'codex' }), 201).agents as Json[];
      assert.equal(made.length, (team.members as Json[]).length, String(team.key));
      assert.ok(
        made.every((a) => a.tool === 'codex'),
        String(team.key),
      );
    }
    const blog = ok(await make('blog'), 201).agents as Json[];
    assert.deepEqual((blog[0] as Json).approvalActions, ['blog.post.publish']);
    assert.equal((blog[1] as Json).reportsTo, (blog[0] as Json).id);
  });

  test('없는 템플릿 · 도구는 422, 모양이 틀리면 400', async () => {
    assert.equal((await make('nope')).status, 422);
    assert.equal((await make('contest', { tool: 'gpt' })).status, 422);
    const noId = await api.request('POST', '/api/agent-teams', owner, { team: 'contest' });
    assert.equal(noId.status, 400);
  });
});
