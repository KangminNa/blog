import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';

// /api/goals: 보는 사람별 결과 (방문자 · write 기기 · 주인), 목표 나무와 이어진 작업.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'goal-writer')}` };
});
after(() => api.close());

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

async function newGoal(title: string, more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/goals', owner, { requestId: randomUUID(), title, ...more }),
    201,
  );
}

async function goals(): Promise<Json[]> {
  return ok(await api.get('/api/goals', owner)).goals as Json[];
}

describe('목표 (/api/goals)', () => {
  test('방문자와 write 기기는 보지도 만들지도 바꾸지도 못한다 (403)', async () => {
    const goal = await newGoal('막힘 확인');
    for (const headers of [{}, writer]) {
      const as = (method: string, path: string, body?: object) =>
        api.request(method, path, TestUser.visitor, body, headers);
      assert.equal((await as('GET', '/api/goals')).status, 403);
      const made = await as('POST', '/api/goals', { requestId: randomUUID(), title: '막힘' });
      assert.equal(made.status, 403, made.text);
      const changed = await as('PATCH', `/api/goals/${goal.id}`, {
        title: '막힘',
        version: goal.version,
      });
      assert.equal(changed.status, 403);
      const closed = await as('POST', `/api/goals/${goal.id}/status`, {
        status: 'done',
        version: goal.version,
      });
      assert.equal(closed.status, 403);
    }
  });

  test('주인은 나무를 만든다: 맨 위가 회사 목표, 같은 requestId는 하나', async () => {
    const requestId = randomUUID();
    const company = ok(
      await api.request('POST', '/api/goals', owner, { requestId, title: '  회사 목표  ' }),
      201,
    );
    assert.equal(company.title, '회사 목표', '앞뒤 공백은 뺀다');
    assert.equal(company.parentId, null);
    assert.equal(company.status, 'active');
    const again = ok(
      await api.request('POST', '/api/goals', owner, { requestId, title: '회사 목표' }),
      201,
    );
    assert.equal(again.id, company.id, '같은 requestId는 처음 것');

    const blog = await newGoal('블로그', { parentId: company.id, description: '매달 글 4편' });
    assert.equal(blog.parentId, company.id);
    const list = await goals();
    assert.ok(list.some((g) => g.id === blog.id && g.description === '매달 글 4편'));
  });

  test('없는 부모, 빈 제목, 5단계보다 깊은 목표는 만들 수 없다', async () => {
    const missing = await api.request('POST', '/api/goals', owner, {
      requestId: randomUUID(),
      title: '고아',
      parentId: randomUUID(),
    });
    assert.equal(missing.status, 404, missing.text);
    const blank = await api.request('POST', '/api/goals', owner, {
      requestId: randomUUID(),
      title: '   ',
    });
    assert.equal(blank.status, 422, blank.text);

    let parent = await newGoal('1');
    for (const title of ['2', '3', '4', '5'])
      parent = await newGoal(title, { parentId: parent.id });
    const deep = await api.request('POST', '/api/goals', owner, {
      requestId: randomUUID(),
      title: '6',
      parentId: parent.id,
    });
    assert.equal(deep.status, 422, deep.text);
  });

  test('version을 맞춰 고치고, 보내지 않은 칸은 그대로다', async () => {
    const goal = await newGoal('처음', { description: '설명' });
    const changed = ok(
      await api.request('PATCH', `/api/goals/${goal.id}`, owner, {
        title: '바뀜',
        sort: 3,
        version: goal.version,
      }),
    );
    assert.equal(changed.title, '바뀜');
    assert.equal(changed.description, '설명');
    assert.equal(changed.sort, 3);
    const stale = await api.request('PATCH', `/api/goals/${goal.id}`, owner, {
      title: '늦음',
      version: goal.version,
    });
    assert.equal(stale.status, 409, '늦은 쓰기는 덮지 않는다');
  });

  test('끝내거나 그만둔 목표에는 작업과 하위 목표를 더할 수 없고, 다시 열면 된다', async () => {
    const goal = await newGoal('끝낼 목표');
    const done = ok(
      await api.request('POST', `/api/goals/${goal.id}/status`, owner, {
        status: 'done',
        version: goal.version,
      }),
    );
    assert.equal(done.status, 'done');
    const task = await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      instruction: '끝난 목표의 일',
      goalId: goal.id,
    });
    assert.equal(task.status, 422, task.text);
    const child = await api.request('POST', '/api/goals', owner, {
      requestId: randomUUID(),
      title: '하위',
      parentId: goal.id,
    });
    assert.equal(child.status, 422, child.text);
    const wrong = await api.request('POST', `/api/goals/${goal.id}/status`, owner, {
      status: 'deleted',
      version: done.version,
    });
    assert.equal(wrong.status, 422, '목표는 지우지 않는다');

    const reopened = ok(
      await api.request('POST', `/api/goals/${goal.id}/status`, owner, {
        status: 'active',
        version: done.version,
      }),
    );
    assert.equal(reopened.status, 'active');
    await newGoal('다시 연 뒤의 하위', { parentId: goal.id });
  });

  test('작업은 목표에 이어진다: 목표별 작업, 개수, 상세의 목표 사슬', async () => {
    const company = await newGoal('사슬의 맨 위');
    const month = await newGoal('이번 달', { parentId: company.id });
    const made = ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        instruction: '목표에 이어진 일',
        goalId: month.id,
      }),
      201,
    );
    assert.equal(made.goalId, month.id);
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        instruction: '목표 없는 일',
      }),
      201,
    );

    const byGoal = ok(await api.get(`/api/tasks?goalId=${month.id}`, owner)).tasks as Json[];
    assert.deepEqual(
      byGoal.map((t) => t.id),
      [made.id],
    );
    const counted = (await goals()).find((g) => g.id === month.id);
    assert.equal(counted?.openTasks, 1);
    assert.equal(counted?.doneTasks, 0);

    const detail = ok(await api.get(`/api/tasks/${made.id}`, owner));
    assert.deepEqual(
      (detail.goalChain as Json[]).map((g) => g.title),
      ['사슬의 맨 위', '이번 달'],
      '회사 목표부터',
    );

    const missing = await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      instruction: '없는 목표',
      goalId: randomUUID(),
    });
    assert.equal(missing.status, 404, missing.text);
  });

  test('모양이 틀리면 400과 고칠 칸', async () => {
    const res = await api.request('POST', '/api/goals', owner, { requestId: 'nope' });
    assert.equal(res.status, 400, res.text);
    const fields = res.json().fields as Record<string, string>;
    assert.ok(fields.requestId);
    assert.ok(fields.title);
  });
});
