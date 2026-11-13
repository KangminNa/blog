import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { OutboxWorker } from '../../platform';

// 목표 실행: 주인이 목표에 팀장을 정해 맡기면 회차가 이어 돌고, 주인은 중간 · 최종 결재문만 받는다.
// 러너 대신 시험이 팀장 노릇을 한다 (next_jobs로 회차 작업을 빌리고, report_round로 보고하고, submit_result로 끝낸다).
// 회차를 잇는 일은 일꾼(outbox)이 하므로 drain으로 돌린다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let runner: string;
let worker: OutboxWorker;
let lead: Json;
let goal: Json;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};

async function tool(
  token: string,
  name: string,
  args: Json = {},
): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  const result = res.json().result as {
    isError?: boolean;
    structuredContent?: Json;
    content: { text: string }[];
  };
  assert.ok(result, res.text);
  if (result.isError) return { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') };
  return { ok: true, body: result.structuredContent ?? {} };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
}

/** 이 실행의 지금 회차 작업을 빌린다 (다른 시험 파일의 일은 건너뛴다) */
async function takeRound(
  runId: string,
): Promise<{ task: Json; instruction: string; run_token: string }> {
  for (let i = 0; i < 20; i++) {
    const { body } = await tool(runner, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
    });
    const jobs = body.jobs as { task: Json; instruction: string; run_token: string }[];
    const mine = jobs.find(
      (j) => ((j.task.payload as Json | undefined)?.goalRun as Json | undefined)?.runId === runId,
    );
    if (mine) return mine;
    if (jobs.length === 0) break;
  }
  throw new Error('회차 작업이 없다');
}

/** 팀장 노릇: 보고하고 끝낸다 */
async function finishRound(
  job: { task: Json; run_token: string },
  report: Json | null,
): Promise<void> {
  if (report) {
    const reported = await tool(job.run_token, 'report_round', report);
    assert.ok(reported.ok, JSON.stringify(reported.body));
  }
  const done = await tool(runner, 'submit_result', {
    task_id: job.task.id,
    request_id: randomUUID(),
    status: 'done',
    result: { text: '회차 끝' },
  });
  assert.ok(done.ok, JSON.stringify(done.body));
  await drain();
}

const runOf = async (id: unknown) => ok(await api.get(`/api/goal-runs/${id}`, owner));
const approvalOf = async (id: unknown) => ok(await api.get(`/api/approvals/${id}`, owner));
const decide = async (approvalId: unknown, decision: string, note?: string) => {
  const approval = await approvalOf(approvalId);
  ok(
    await api.request('POST', `/api/approvals/${approvalId}/decide`, owner, {
      version: approval.version,
      decision,
      note,
    }),
  );
  await drain();
};

async function start(more: Json = {}): Promise<Json> {
  return ok(
    await api.request('POST', '/api/goal-runs', owner, {
      requestId: randomUUID(),
      goalId: goal.id,
      agentId: lead.id,
      instruction: '서울 데이트 코스 세 곳을 확인해 정리해 줘 https://example.com/seoul',
      criteria: ['장소 세 곳', '각 장소의 주소 확인'],
      ...more,
    }),
    201,
  );
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  worker = api.service(OutboxWorker);
  const space = ok(await api.get('/api/space'));
  ok(
    await api.request('PUT', '/api/space', owner, {
      name: space.name || '목표 실행',
      siteUrl: api.baseUrl,
      version: space.version,
    }),
  );
  runner = String(
    ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: 'goal-runner',
      }),
      201,
    ).token,
  );
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  lead = ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: `팀장 ${randomUUID().slice(0, 6)}`,
      tool: 'claude',
      scopes: ['read_public'],
    }),
    201,
  );
  goal = ok(
    await api.request('POST', '/api/goals', owner, { requestId: randomUUID(), title: '주말 계획' }),
    201,
  );
});
after(() => api.close());

describe('목표 실행', () => {
  test('회차가 이어 돌고, 다 됐다는 보고에 최종 결재 → 승인하면 완료 (주인은 결재문만 받는다)', async () => {
    const run = await start({ checkpoint: 'final', maxRounds: 5 });
    assert.deepEqual([run.status, run.round, run.checkpoint], ['running', 1, 'final']);

    const first = await takeRound(String(run.id));
    assert.match(first.instruction, /# 목표 실행 1회차/);
    assert.match(first.instruction, /\[ \] 장소 세 곳/);
    await finishRound(first, {
      summary: '두 곳을 찾았다',
      completed: ['서울숲 확인', '성수 카페 확인'],
      remaining: ['세 번째 장소'],
      evidence: [{ url: 'https://example.com/seoul', note: '목록' }],
      next_plan: '한강 쪽을 찾는다',
      done: false,
    });
    // 결재 시점이 final이고 나아갔으니 결재 없이 2회차가 열린다. 앞 회차 보고가 지시에 실린다
    assert.deepEqual([(await runOf(run.id)).round, (await runOf(run.id)).status], [2, 'running']);
    const second = await takeRound(String(run.id));
    assert.match(second.instruction, /앞 회차\(1회차\) 보고/);
    assert.match(second.instruction, /세 번째 장소/);

    await finishRound(second, {
      summary: '세 곳 모두 확인',
      completed: ['뚝섬 확인'],
      remaining: [],
      done: true,
    });
    const waiting = await runOf(run.id);
    assert.equal(waiting.status, 'waiting');
    const approval = await approvalOf(waiting.pendingApprovalId);
    assert.equal(approval.action, 'task.goal.complete');
    assert.match(String(approval.note), /2회차 · 팀장이 완료 조건을 다 채웠다고/);
    assert.equal((waiting.rounds as Json[]).length, 2, '결재문의 본문: 회차 보고 전부');

    await decide(waiting.pendingApprovalId, 'approve');
    const done = await runOf(run.id);
    assert.deepEqual([done.status, done.pendingApprovalId], ['done', null]);
    assert.ok(done.finishedAt);
  });

  test('결재 시점(milestone · every), 진전 없음, 회차 한도에서 중간 결재. 고쳐 달라는 말은 다음 회차로', async () => {
    const run = await start({ checkpoint: 'milestone', maxRounds: 2 });
    const first = await takeRound(String(run.id));
    await finishRound(first, {
      summary: '구조 잡음',
      completed: ['후보 목록'],
      remaining: ['확인'],
      done: false,
      milestone: true,
    });
    let now = await runOf(run.id);
    assert.equal(now.status, 'waiting', '중요 단계라 중간 결재');
    assert.equal((await approvalOf(now.pendingApprovalId)).action, 'task.goal.continue');
    await decide(now.pendingApprovalId, 'revise', '야경 명소를 꼭 넣어 줘');

    const second = await takeRound(String(run.id));
    assert.match(second.instruction, /주인의 말 \(결재에서\)\n야경 명소를 꼭 넣어 줘/);
    await finishRound(second, {
      summary: '확인 중',
      completed: ['야경 추가'],
      remaining: ['마지막 확인'],
      done: false,
    });
    now = await runOf(run.id);
    assert.equal(now.status, 'waiting', '회차 한도(2)');
    assert.match(String((await approvalOf(now.pendingApprovalId)).note), /회차 한도\(2\)/);
    await decide(now.pendingApprovalId, 'approve');
    assert.deepEqual(
      [(await runOf(run.id)).round, (await runOf(run.id)).maxRounds],
      [3, 3],
      '승인하면 한 회차 늘어난다',
    );

    const third = await takeRound(String(run.id));
    await finishRound(third, {
      summary: '아무것도 못 함',
      completed: [],
      remaining: ['마지막 확인'],
      done: false,
    });
    now = await runOf(run.id);
    assert.match(String((await approvalOf(now.pendingApprovalId)).note), /회차 한도|한 일이 없고/);
    await decide(now.pendingApprovalId, 'reject');
    assert.equal((await runOf(run.id)).status, 'stopped', '거절하면 멈춘다');
  });

  test('보고 없이 끝나거나 실패하면 중간 결재로 묻는다', async () => {
    const run = await start({ checkpoint: 'final' });
    await finishRound(await takeRound(String(run.id)), null);
    const now = await runOf(run.id);
    assert.equal(now.status, 'waiting');
    assert.match(String((await approvalOf(now.pendingApprovalId)).note), /보고 없이/);
  });

  test('report_round: 회차 작업만, 회차마다 한 번. 멈추면 도는 회차 작업도 취소', async () => {
    const run = await start();
    const job = await takeRound(String(run.id));
    const first = await tool(job.run_token, 'report_round', { summary: '한 번', done: false });
    assert.ok(first.ok);
    const again = await tool(job.run_token, 'report_round', { summary: '두 번', done: false });
    assert.equal(again.ok, false);
    assert.match(String(again.body.message), /이미 보고했어요/);

    const stopped = ok(
      await api.request('POST', `/api/goal-runs/${run.id}/stop`, owner, { version: run.version }),
    );
    assert.equal(stopped.status, 'stopped');
    const task = ok(await api.get(`/api/tasks/${job.task.id}`, owner));
    assert.equal(task.status, 'cancelled');
    await drain();
    assert.equal(
      (await runOf(run.id)).status,
      'stopped',
      '취소된 회차 작업이 실행을 다시 움직이지 않는다',
    );
  });

  test('주인만: 방문자 · write 기기는 시작 · 읽기를 못 한다. 틀린 입력은 400 · 422', async () => {
    const writer = {
      authorization: `Bearer ${await api.writeDevice(owner, `gr-writer-${randomUUID().slice(0, 6)}`)}`,
    };
    const body = { requestId: randomUUID(), goalId: goal.id, agentId: lead.id, instruction: 'x' };
    for (const headers of [{}, writer]) {
      const made = await api.request('POST', '/api/goal-runs', TestUser.visitor, body, headers);
      assert.equal(made.status, 403, made.text);
      const read = await api.request('GET', '/api/goal-runs', TestUser.visitor, undefined, headers);
      assert.equal(read.status, 403, read.text);
    }
    assert.equal(
      (await api.request('POST', '/api/goal-runs', owner, { ...body, instruction: '' })).status,
      400,
    );
    assert.equal(
      (
        await api.request('POST', '/api/goal-runs', owner, {
          ...body,
          requestId: randomUUID(),
          checkpoint: 'never',
        })
      ).status,
      422,
    );
    const list = ok(await api.get(`/api/goal-runs?goalId=${goal.id}`, owner));
    assert.ok((list.runs as Json[]).length >= 4);
  });
});
