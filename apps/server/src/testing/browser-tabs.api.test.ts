import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Database, OutboxWorker } from '../modules/platform';
import { ApiClient, TestUser } from './api-client';

// 기능 패키지 browser-tabs의 브라우저 에이전트 (2차 3단계 서버 브라우저 목표, 2026-11-14).
// 사이트 일 · 둘러보기 맡기기, 러너의 browser_job · 단계 화면 · 로그인 필요 · 결재된 클릭(붙잡기 → 승인 → 누르기 · 바뀜),
// 세션 지우기, 브라우저 일의 위임 규칙. 보는 사람별: 방문자 · write 기기 · 러너(쥔 · 쥐지 않은) · 에이전트 · 관리자.
// 브라우저는 없다 (러너 쪽은 apps/runner의 단위 · 통합 테스트가 진짜 Chromium으로 본다).

type Json = Record<string, unknown>;
const BASE = '/api/p/browser-tabs';
const SITE = {
  name: '시험 블로그',
  startUrl: 'https://blog.example/write',
  origins: ['https://blog.example'],
};
/** 앞부분만 JPEG인 작은 그림 (서버는 형식을 앞부분으로 본다) */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');
const FINGERPRINT = 'a'.repeat(64);

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let runner: string;
let other: string;
let agentId: string;

const ok = (res: { status: number; text: string; json(): unknown }, status = 200): Json => {
  assert.equal(res.status, status, res.text);
  return res.json() as Json;
};
const drain = async () => {
  const worker = api.service(OutboxWorker);
  for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
};

async function tool(
  token: string,
  name: string,
  args: Json = {},
): Promise<{ ok: boolean; body: Json }> {
  const res = await api.mcp(token, 'tools/call', { name, arguments: args });
  assert.equal(res.status, 200, res.text);
  const result = res.json().result as {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Json;
  };
  return result.isError
    ? { ok: false, body: JSON.parse(result.content[0]?.text ?? '{}') }
    : { ok: true, body: result.structuredContent ?? {} };
}

async function newRunner(name: string): Promise<string> {
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name,
  });
  return String(ok(made, 201).token);
}

async function newAgent(name: string, scopes: string[], more: Json = {}): Promise<string> {
  const made = await api.request('POST', '/api/agents', owner, {
    requestId: randomUUID(),
    name,
    tool: 'claude',
    scopes,
    approvalActions: ['browser.site.publish', 'browser.site.login'],
    ...more,
  });
  return String(ok(made, 201).id);
}

const newSite = async (): Promise<Json> =>
  ok(await api.request('POST', `${BASE}/sites`, owner, SITE));

/** 맡긴 일(제목에 표시)을 러너가 빌린다. 같은 DB의 다른 시험이 남긴 일이 먼저 올 수 있어 그 일이 올 때까지 */
async function leased(mark: string, token = runner): Promise<Json> {
  for (let round = 0; round < 20; round++) {
    const next = await tool(token, 'next_jobs', {
      wait_seconds: 0,
      limit: 10,
      tools: ['claude'],
      own_logins: ['claude'],
      browser: true,
    });
    const job = (next.body.jobs as Json[]).find((j) =>
      String((j.task as Json).title).includes(mark),
    );
    if (job) return job;
  }
  throw new Error(`빌린 일이 없다: ${mark}`);
}

/** 사이트에 일을 맡기고 러너가 빌린다 */
async function siteJob(site: Json): Promise<{ job: Json; taskId: string; run: string }> {
  const mark = randomUUID().slice(0, 8);
  ok(
    await api.request('POST', `${BASE}/sites/${site.id}/tasks`, owner, {
      requestId: randomUUID(),
      instruction: `글을 채워 주세요 ${mark}`,
      agentId,
    }),
  );
  await drain();
  const job = await leased(mark);
  return { job, taskId: String((job.task as Json).id), run: String(job.run_token) };
}

const hold = (taskId: string, more: Json = {}) =>
  tool(runner, 'browser_click_hold', {
    task_id: taskId,
    tab_id: 'A'.repeat(32),
    page_url: 'https://blog.example/write?draft=1',
    page_title: '글쓰기',
    role: 'button',
    name: '게시',
    nth: 0,
    box: { x: 10, y: 20, width: 80, height: 30 },
    fingerprint: FINGERPRINT,
    note: '제목과 본문을 채웠어요',
    image: JPEG,
    ...more,
  });

/** 붙잡고 러너가 작업 토큰으로 클릭 결재를 올린다 */
async function heldClick(
  taskId: string,
  run: string,
): Promise<{ clickId: string; approval: Json }> {
  const held = await hold(taskId);
  assert.equal(held.ok, true, JSON.stringify(held.body));
  const asked = await tool(run, 'request_approval', {
    request_id: `click-${held.body.click_id}`,
    action: 'browser.site.publish',
    target_kind: 'browser_click',
    target_id: held.body.click_id,
    target_version: held.body.version,
    note: '게시 버튼',
  });
  assert.equal(asked.ok, true, JSON.stringify(asked.body));
  const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
  return { clickId: String(held.body.click_id), approval };
}

const decide = async (approval: Json, decision: string, note?: string) => {
  ok(
    await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
      version: approval.version,
      decision,
      ...(note ? { note } : {}),
    }),
  );
  await drain();
};
const taskOf = async (id: string): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));
const clickOf = async (id: string): Promise<Json> =>
  ok(await api.get(`${BASE}/clicks/${id}`, owner));

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'browser-writer')}` };
  runner = await newRunner('브라우저 러너');
  other = await newRunner('다른 러너');
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  ok(await api.request('POST', '/api/plugins/browser-tabs/enable', owner));
  agentId = await newAgent('브라우저 담당', ['read_public', 'browse']);
});
after(async () => {
  // 다음 시험 파일이 보는 도구 목록이 패키지 상태에 흔들리지 않게 끄고 끝낸다
  await api.request('POST', '/api/plugins/browser-tabs/disable', owner);
  await api.close();
});

describe('브라우저 에이전트: 관리자 입구', () => {
  test('방문자 · write 기기는 사이트 · 둘러보기 · 클릭 · 화면 · 세션 지우기를 못 한다 (403)', async () => {
    const id = randomUUID();
    const calls = [
      ['GET', `${BASE}/sites`, undefined],
      ['POST', `${BASE}/sites`, SITE],
      ['POST', `${BASE}/explore`, { requestId: randomUUID(), instruction: '가격 비교' }],
      ['POST', `${BASE}/sites/${id}/clear-session`, {}],
      ['GET', `${BASE}/clicks`, undefined],
      ['GET', `${BASE}/clicks/${id}`, undefined],
      ['POST', `${BASE}/clicks/${id}/manual`, { version: 1, done: true }],
      ['GET', `${BASE}/shots?taskId=${id}`, undefined],
      ['GET', `${BASE}/shots/${id}`, undefined],
      ['GET', `${BASE}/screen`, undefined],
    ] as const;
    for (const [method, path, body] of calls)
      for (const headers of [{}, writer]) {
        const res = await api.request(method, path, TestUser.visitor, body, headers);
        assert.equal(res.status, 403, `${method} ${path}: ${res.text}`);
      }
  });

  test('사이트는 관리자만 등록하고 출처 모양 · 시작 주소를 본다. 로그인 필요 표시는 비어 있다', async () => {
    const site = await newSite();
    assert.deepEqual(site.origins, ['https://blog.example']);
    assert.equal(site.loginNeededAt, null);
    for (const bad of [
      { ...SITE, origins: ['https://blog.example/path'] },
      { ...SITE, origins: ['*.example.com'] },
      { ...SITE, startUrl: 'https://other.example/' },
    ])
      assert.equal((await api.request('POST', `${BASE}/sites`, owner, bad)).status, 422);
    const path = `${BASE}/sites/${site.id}`;
    const changed = ok(
      await api.request('PATCH', path, owner, { version: site.version, name: '새 이름' }),
    );
    assert.equal(
      (await api.request('PATCH', path, owner, { version: site.version, name: 'x' })).status,
      409,
    );
    ok(await api.request('DELETE', path, owner, { version: changed.version }));
  });

  test('영상의 관리자 확인(GET /viewer)은 없다. 화면 · 세션 지우기는 브라우저가 없으면 502', async () => {
    assert.equal((await api.request('GET', `${BASE}/viewer`, owner)).status, 404);
    const none = await api.request('GET', `${BASE}/screen`, owner);
    assert.equal(none.status, 502, none.text);
    const site = await newSite();
    const clear = await api.request('POST', `${BASE}/sites/${site.id}/clear-session`, owner, {});
    assert.equal(clear.status, 502, clear.text);
    assert.match(clear.text, /서버 브라우저가 꺼져 있거나/);
    const missing = await api.request(
      'POST',
      `${BASE}/sites/${randomUUID()}/clear-session`,
      owner,
      {},
    );
    assert.equal(missing.status, 404);
  });

  test('둘러보기를 맡기면 대상 없는 browse 작업이 되고, 러너에게는 explore. 누르기 · 로그인은 거절', async () => {
    const mark = randomUUID().slice(0, 8);
    ok(
      await api.request('POST', `${BASE}/explore`, owner, {
        requestId: randomUUID(),
        instruction: `노트북 가격 비교 ${mark}`,
        agentId,
      }),
    );
    await drain();
    const job = await leased(mark);
    const task = job.task as Json;
    assert.equal(task.kind, 'browse');
    assert.match(String(task.title), /^둘러보기: 노트북 가격 비교/);
    assert.equal((job.target as Json | null)?.kind ?? null, null);
    const plan = await tool(runner, 'browser_job', { task_id: task.id });
    assert.deepEqual(plan.body, { mode: 'explore', site: null, login_needed: false, held: null });
    const held = await hold(String(task.id));
    assert.equal(held.ok, false);
    assert.match(JSON.stringify(held.body), /둘러보기에서는/);
    const login = await tool(runner, 'browser_login_needed', {
      task_id: task.id,
      page_url: 'https://x.example/login',
    });
    assert.equal(login.ok, false);
  });
});

describe('브라우저 에이전트: 결재된 클릭', () => {
  test('사이트 일: browser_job · 단계 화면 · 붙잡기 → 결재 → 그 러너만 가져가 누르면 작업이 끝난다', async () => {
    const site = await newSite();
    const { job, taskId, run } = await siteJob(site);
    assert.deepEqual(job.target, { kind: 'browser_site', id: site.id, version: site.version });
    assert.equal(
      ((job.task as Json).payload as Json).site,
      undefined,
      '사이트 값은 payload에 싣지 않는다',
    );

    assert.equal(
      (await tool(other, 'browser_job', { task_id: taskId })).ok,
      false,
      '쥐지 않은 러너',
    );
    const plan = await tool(runner, 'browser_job', { task_id: taskId });
    assert.deepEqual(plan.body, {
      mode: 'site',
      site: {
        id: site.id,
        version: site.version,
        name: SITE.name,
        start_url: SITE.startUrl,
        origins: SITE.origins,
      },
      login_needed: false,
      held: null,
    });
    const step = await tool(runner, 'browser_shot_save', {
      task_id: taskId,
      url: SITE.startUrl,
      title: '편집기',
      image: JPEG,
    });
    assert.deepEqual(step.body, { id: step.body.id, seq: 1 });
    const png = await tool(runner, 'browser_shot_save', {
      task_id: taskId,
      image: Buffer.from('GIF89a').toString('base64'),
    });
    assert.equal(png.ok, false, 'JPEG · PNG만');

    const outside = await hold(taskId, { page_url: 'https://evil.example/write' });
    assert.equal(outside.ok, false);
    assert.match(JSON.stringify(outside.body), /허용 출처 밖/);
    const { clickId, approval } = await heldClick(taskId, run);
    assert.equal((await taskOf(taskId)).status, 'waiting');
    const card = await clickOf(clickId);
    assert.equal(card.status, 'held');
    assert.equal(card.beforeImage, JPEG);
    assert.deepEqual(card.box, { x: 10, y: 20, width: 80, height: 30 });
    assert.equal(card.siteName, SITE.name);

    assert.deepEqual((await tool(runner, 'browser_click_next')).body, { click: null }, '승인 전');
    await decide(approval, 'approve');
    assert.equal((await clickOf(clickId)).status, 'approved');
    // 같은 승인 이벤트가 한 번 더 와도 (일꾼이 처리 표시 전에 멈춘 뒤) 승인된 클릭을 실패로 돌리지 않는다
    await api.service(Database).sql`
      UPDATE platform.outbox SET processed_at = NULL
      WHERE topic = 'task.approval.granted' AND payload->>'approvalId' = ${String(approval.id)}`;
    await drain();
    assert.equal((await clickOf(clickId)).status, 'approved');
    assert.equal((await taskOf(taskId)).status, 'running', '결과를 기다린다');
    assert.deepEqual(
      (await tool(other, 'browser_click_next')).body,
      { click: null },
      '붙잡은 러너만',
    );
    const next = (await tool(runner, 'browser_click_next')).body.click as Json;
    assert.deepEqual(
      [next.id, next.task_id, next.role, next.name, next.nth, next.fingerprint, next.page_url],
      [clickId, taskId, 'button', '게시', 0, FINGERPRINT, 'https://blog.example/write?draft=1'],
    );
    const saved = await tool(runner, 'browser_click_save', {
      id: clickId,
      version: next.version,
      outcome: 'clicked',
      after_url: 'https://blog.example/posts/1',
      image: JPEG,
    });
    assert.deepEqual(saved.body, { id: clickId, status: 'clicked' });
    const again = await tool(runner, 'browser_click_save', {
      id: clickId,
      version: next.version,
      outcome: 'clicked',
    });
    assert.equal(again.ok, false, '한 번만');
    await drain();
    assert.equal((await taskOf(taskId)).status, 'done');
    const done = await clickOf(clickId);
    assert.deepEqual(
      [done.status, done.afterUrl, done.afterImage, done.afterKind],
      ['clicked', 'https://blog.example/posts/1', JPEG, 'after'],
    );
    const { shots } = ok(await api.get(`${BASE}/shots?taskId=${taskId}`, owner)) as {
      shots: Json[];
    };
    assert.deepEqual(
      shots.map((s) => [s.seq, s.kind]),
      [
        [1, 'step'],
        [2, 'before'],
        [3, 'after'],
      ],
    );
    const one = ok(await api.get(`${BASE}/shots/${shots[0]?.id}`, owner));
    assert.deepEqual([one.image, one.mime], [JPEG, 'image/jpeg']);
  });

  test('승인 뒤 페이지가 바뀌었으면 누르지 않고(changed) 작업은 실패, 관리자가 직접 한 것을 기록한다', async () => {
    const { taskId, run } = await siteJob(await newSite());
    const { clickId, approval } = await heldClick(taskId, run);
    await decide(approval, 'approve');
    const next = (await tool(runner, 'browser_click_next')).body.click as Json;
    await tool(runner, 'browser_click_save', {
      id: clickId,
      version: next.version,
      outcome: 'changed',
      reason: '버튼이 달라요',
      image: JPEG,
    });
    await drain();
    const task = await taskOf(taskId);
    assert.equal(task.status, 'failed');
    assert.match(
      String((task.result as Json).error),
      /페이지가 바뀌어 누르지 않았어요 \(버튼이 달라요\)\. 콘솔 화면에서 직접/,
    );
    const changed = await clickOf(clickId);
    assert.deepEqual([changed.status, changed.afterKind], ['changed', 'changed']);
    const stale = await api.request('POST', `${BASE}/clicks/${clickId}/manual`, owner, {
      version: 1,
      done: true,
    });
    assert.equal(stale.status, 409);
    const manual = ok(
      await api.request('POST', `${BASE}/clicks/${clickId}/manual`, owner, {
        version: changed.version,
        done: true,
      }),
    );
    assert.deepEqual([manual.status, manual.reason], ['manual', '콘솔 화면에서 직접 눌렀어요']);
  });

  test('승인된 클릭을 관리자가 직접 눌렀다고 기록하면 작업이 끝나고, 러너는 그 클릭을 가져가지 않는다', async () => {
    const { taskId, run } = await siteJob(await newSite());
    const { clickId, approval } = await heldClick(taskId, run);
    await decide(approval, 'approve');
    const click = await clickOf(clickId);
    ok(
      await api.request('POST', `${BASE}/clicks/${clickId}/manual`, owner, {
        version: click.version,
        done: true,
      }),
    );
    await drain();
    assert.equal((await taskOf(taskId)).status, 'done');
    assert.deepEqual((await tool(runner, 'browser_click_next')).body, { click: null });
  });

  test('클릭 결재에서 수정 요청이면 클릭을 닫고, 다시 빌린 일은 붙잡아 둔 페이지를 받는다', async () => {
    const { taskId, run } = await siteJob(await newSite());
    const { clickId, approval } = await heldClick(taskId, run);
    await decide(approval, 'revise', '제목을 바꿔 주세요');
    assert.equal((await clickOf(clickId)).status, 'dropped');
    const task = await taskOf(taskId);
    assert.equal(task.status, 'queued');
    const job = await leased(String(task.title));
    assert.deepEqual((job.target as Json).kind, 'browser_click');
    const plan = await tool(runner, 'browser_job', { task_id: taskId });
    assert.equal(plan.body.mode, 'site');
    assert.deepEqual(plan.body.held, {
      click_id: clickId,
      page_url: 'https://blog.example/write?draft=1',
      tab_id: 'A'.repeat(32),
    });
    const moved = await hold(taskId);
    assert.equal(moved.ok, true, '고친 뒤 다시 붙잡는다');
  });

  test('취소된 작업의 승인된 클릭은 누르지 않는다. 기다리는 클릭이 있는 사이트의 세션은 지우지 않는다 (409)', async () => {
    const site = await newSite();
    const { taskId, run } = await siteJob(site);
    const { clickId, approval } = await heldClick(taskId, run);
    const busy = await api.request('POST', `${BASE}/sites/${site.id}/clear-session`, owner, {});
    assert.equal(busy.status, 409, busy.text);
    await decide(approval, 'approve');
    ok(
      await api.request('POST', `/api/tasks/${taskId}/cancel`, owner, {
        version: (await taskOf(taskId)).version,
      }),
    );
    await drain();
    assert.equal((await clickOf(clickId)).status, 'dropped');
    assert.deepEqual((await tool(runner, 'browser_click_next')).body, { click: null });
  });
});

describe('브라우저 에이전트: 로그인 필요', () => {
  test('로그인 화면 → 사이트에 표시 · 화면 → 결재 → "로그인했어요"(수정 요청)면 표시를 비우고 같은 작업이 이어진다', async () => {
    const site = await newSite();
    const { taskId, run } = await siteJob(site);
    const noticed = await tool(runner, 'browser_login_needed', {
      task_id: taskId,
      page_url: 'https://accounts.example/login',
      page_title: '로그인',
      image: JPEG,
    });
    assert.deepEqual(noticed.body, { site_id: site.id, site_version: site.version });
    const sites = (ok(await api.get(`${BASE}/sites`, owner)).sites as Json[]).find(
      (s) => s.id === site.id,
    ) as Json;
    assert.notEqual(sites.loginNeededAt, null);
    assert.equal(sites.version, site.version, '판은 올리지 않는다');
    const plan = await tool(runner, 'browser_job', { task_id: taskId });
    assert.equal(plan.body.login_needed, true);

    const asked = await tool(run, 'request_approval', {
      request_id: `login-${taskId}`,
      action: 'browser.site.login',
      target_kind: 'browser_site',
      target_id: site.id,
      target_version: site.version,
      note: '로그인 필요: 시험 블로그',
    });
    assert.equal(asked.ok, true, JSON.stringify(asked.body));
    const approval = ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner));
    await decide(approval, 'revise', '로그인했어요');
    const after = (ok(await api.get(`${BASE}/sites`, owner)).sites as Json[]).find(
      (s) => s.id === site.id,
    ) as Json;
    assert.equal(after.loginNeededAt, null);
    const task = await taskOf(taskId);
    assert.equal(task.status, 'queued', '위임 사슬을 끊지 않고 같은 작업이 이어진다');
    const { shots } = ok(await api.get(`${BASE}/shots?taskId=${taskId}`, owner)) as {
      shots: Json[];
    };
    assert.deepEqual(
      shots.map((s) => [s.kind, s.url]),
      [['login', 'https://accounts.example/login']],
    );
  });

  test('로그인 결재를 승인하면 쓰지 않는 길이라 실패로 끝난다. 반려하면 작업이 취소된다', async () => {
    const site = await newSite();
    for (const [decision, status] of [
      ['approve', 'failed'],
      ['reject', 'cancelled'],
    ] as const) {
      const { taskId, run } = await siteJob(site);
      const asked = await tool(run, 'request_approval', {
        request_id: `login-${taskId}`,
        action: 'browser.site.login',
        target_kind: 'browser_site',
        target_id: site.id,
        target_version: site.version,
      });
      await decide(ok(await api.get(`/api/approvals/${asked.body.approval_id}`, owner)), decision);
      const task = await taskOf(taskId);
      assert.equal(task.status, status, decision);
      if (decision === 'approve') assert.match(String((task.result as Json).error), /로그인했어요/);
    }
  });
});

describe('브라우저 일의 위임', () => {
  async function leadJob(scopes: string[]): Promise<{ run: string; member: string; site: Json }> {
    const lead = await newAgent(`팀장 ${scopes.join('+')}`, scopes, { approvalActions: [] });
    const member = await newAgent('팀 브라우저 담당', ['read_public', 'browse'], {
      reportsTo: lead,
    });
    const mark = randomUUID().slice(0, 8);
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: lead,
        title: `조사 ${mark}`,
        instruction: '가입 양식을 채워 주세요',
      }),
      201,
    );
    const job = await leased(mark);
    return { run: String(job.run_token), member, site: await newSite() };
  }
  const order = (member: string, site: Json | null) => ({
    subtasks: [
      {
        request_id: randomUUID(),
        to_agent_id: member,
        kind: 'browse',
        title: '양식 채우기',
        instruction: '이름 칸에 홍길동',
        ...(site
          ? { target_kind: 'browser_site', target_id: site.id, target_version: site.version }
          : {}),
      },
    ],
  });

  test('공개 읽기만 가진 팀장은 사이트 일 · 둘러보기를 맡긴다. 브라우저 담당은 browser_sites로 사이트를 고른다', async () => {
    const { run, member, site } = await leadJob(['read_public']);
    const sites = await tool(run, 'browser_sites');
    assert.ok(
      (sites.body.sites as Json[]).some((s) => s.id === site.id && s.start_url === SITE.startUrl),
    );
    const done = await tool(run, 'delegate_task', order(member, site));
    assert.equal(done.ok, true, JSON.stringify(done.body));
    const child = await taskOf(String(((done.body.subtasks as Json[])[0] as Json).task_id));
    assert.deepEqual(
      [child.kind, (child.target as Json).kind, (child.target as Json).id],
      ['browse', 'browser_site', site.id],
    );
  });

  test('전체 읽기 · 초안 작성 권한이 있는 팀장은 브라우저 일을 맡기지 못한다', async () => {
    for (const scopes of [['read_all'], ['read_public', 'write']]) {
      const { run, member } = await leadJob(scopes);
      const refused = await tool(run, 'delegate_task', order(member, null));
      assert.equal(refused.ok, false, scopes.join());
      assert.match(JSON.stringify(refused.body), /브라우저 일을 맡기지 못해요/);
    }
  });
});
