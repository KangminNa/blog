import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, TestUser } from '../../../testing/api-client';
import { OutboxWorker } from '../worker/outbox-worker';

// 기능 패키지의 입구 (/api/p/<패키지>/…, MCP 도구): 첫 패키지 browser-tabs로 본다.
// 꺼져 있으면 경로 · 도구가 없는 것과 같고, 켜면 목록 파일의 경로 · 도구가 열린다. 보는 사람별: 방문자 · write 기기 · 러너 · 주인.

type Json = Record<string, unknown>;
const PATH = '/api/p/browser-tabs/reads';

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let runner: string;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'tabs-writer')}` };
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name: '탭 러너',
  });
  assert.equal(made.status, 201, made.text);
  runner = String(made.json().token);
  const on = await api.request('POST', '/api/plugins/browser-tabs/enable', owner);
  assert.equal(on.status, 200, on.text);
});
after(() => api.close());

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

async function toolNames(token: string): Promise<string[]> {
  const res = await api.mcp(token, 'tools/list');
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

describe('기능 패키지 (browser-tabs)', () => {
  test('방문자와 write 기기는 주인만인 동작을 못 한다 (403), 없는 경로는 404', async () => {
    for (const headers of [{}, writer]) {
      const list = await api.request('GET', PATH, TestUser.visitor, undefined, headers);
      assert.equal(list.status, 403, list.text);
      const made = await api.request(
        'POST',
        PATH,
        TestUser.visitor,
        { url: 'https://a.example' },
        headers,
      );
      assert.equal(made.status, 403, made.text);
    }
    assert.equal((await api.request('GET', '/api/p/browser-tabs/nope', owner)).status, 404);
    assert.equal((await api.request('GET', '/api/p/no-such-package/reads', owner)).status, 404);
  });

  test('주인이 요청하면 러너가 MCP로 받아 읽고 남기고, 주인 목록에 결과가 보인다', async () => {
    const made = await api.request('POST', PATH, owner, { url: 'https://news.example/today' });
    assert.ok([200, 201].includes(made.status), made.text);

    const pending = await tool(runner, 'browser_tab_pending');
    assert.equal(pending.ok, true, JSON.stringify(pending.body));
    const asked = (pending.body.reads as { id: string; url: string }[]).find(
      (r) => r.url === 'https://news.example/today',
    );
    assert.ok(asked, '요청한 주소가 러너에게 간다');

    const saved = await tool(runner, 'browser_tab_save', {
      id: asked.id,
      title: '오늘',
      body: '본문',
    });
    assert.deepEqual(saved.body, { id: asked.id, status: 'done' });
    const again = await tool(runner, 'browser_tab_save', { id: asked.id, title: '두 번째' });
    assert.equal(again.ok, false, '요청 하나에 한 번만 남긴다');

    const list = (await api.get(PATH, owner)).json().reads as Json[];
    const shown = list.find((r) => r.id === asked.id);
    assert.equal(shown?.status, 'done');
    assert.equal(shown?.title, '오늘');
  });

  test('모양이 틀리면 400과 고칠 칸, http · https만', async () => {
    const empty = await api.request('POST', PATH, owner, {});
    assert.equal(empty.status, 400, empty.text);
    assert.ok((empty.json().fields as Json).url);
    assert.equal((await api.request('POST', PATH, owner, { url: 'ftp://x' })).status, 422);
  });

  test('러너에게는 러너 도구만 보이고, 끄면 경로와 도구가 사라진다', async () => {
    const names = await toolNames(runner);
    assert.ok(names.includes('browser_tab_pending') && names.includes('browser_tab_save'));
    const off = await api.request('POST', '/api/plugins/browser-tabs/disable', owner);
    assert.equal(off.status, 200, off.text);
    assert.equal((await api.request('GET', PATH, owner)).status, 404);
    assert.equal((await toolNames(runner)).includes('browser_tab_pending'), false);
    await api.request('POST', '/api/plugins/browser-tabs/enable', owner);
  });
});

// 브라우저 에이전트 (2026-11-08): 사이트를 등록하고 일을 맡기면 코어가 browse 작업을 만들고(task:request),
// 서버 러너의 AI가 발행 직전에 결재를 올리면, 주인이 직접 발행하고 승인할 때 패키지가 작업을 끝낸다(이벤트로 도는 동작).
describe('기능 패키지: 브라우저 에이전트 (browser-tabs)', () => {
  const SITES = '/api/p/browser-tabs/sites';
  const SITE = {
    name: '시험 블로그',
    startUrl: 'https://blog.example/write',
    origins: ['https://blog.example'],
  };
  const drain = async () => {
    const worker = api.service(OutboxWorker);
    for (let i = 0; i < 200 && (await worker.tick()) > 0; i++);
  };
  const newSite = async (): Promise<Json> => {
    const made = await api.request('POST', SITES, owner, SITE);
    assert.ok([200, 201].includes(made.status), made.text);
    return made.json();
  };

  test('사이트는 주인만 보고 등록한다. 출처 모양과 시작 주소를 본다', async () => {
    for (const headers of [{}, writer]) {
      assert.equal(
        (await api.request('GET', SITES, TestUser.visitor, undefined, headers)).status,
        403,
      );
      const made = await api.request('POST', SITES, TestUser.visitor, SITE, headers);
      assert.equal(made.status, 403, made.text);
    }
    const site = await newSite();
    assert.deepEqual(site.origins, ['https://blog.example']);
    const listed = (await api.get(SITES, owner)).json().sites as Json[];
    assert.ok(listed.some((s) => s.id === site.id));

    const missing = await api.request('POST', SITES, owner, {
      name: 'x',
      startUrl: 'https://a.example',
    });
    assert.equal(missing.status, 400, missing.text);
    assert.ok((missing.json().fields as Json).origins);
    for (const bad of [
      { ...SITE, origins: ['https://blog.example/path'] },
      { ...SITE, origins: ['*.example.com'] },
      { ...SITE, startUrl: 'https://other.example/' },
    ]) {
      const res = await api.request('POST', SITES, owner, bad);
      assert.equal(res.status, 422, `${JSON.stringify(bad)} ${res.text}`);
    }
  });

  test('사이트를 고치고 지울 때는 판(version)이 맞아야 한다', async () => {
    const site = await newSite();
    const path = `${SITES}/${site.id}`;
    const changed = await api.request('PATCH', path, owner, {
      version: site.version,
      name: '새 이름',
    });
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.json().name, '새 이름');
    const stale = await api.request('PATCH', path, owner, {
      version: site.version,
      name: '늦은 쓰기',
    });
    assert.equal(stale.status, 409, stale.text);
    const gone = await api.request('DELETE', path, owner, { version: changed.json().version });
    assert.equal(gone.status, 200, gone.text);
    assert.equal((await api.request('PATCH', path, owner, { version: 2, name: 'x' })).status, 404);
  });

  test('화면 확인(Caddy forward_auth)은 주인만 통과한다', async () => {
    assert.equal((await api.request('GET', '/api/p/browser-tabs/viewer', owner)).status, 200);
    for (const headers of [{}, writer]) {
      const res = await api.request(
        'GET',
        '/api/p/browser-tabs/viewer',
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(res.status, 403, res.text);
    }
  });

  test('일을 맡기면 browse 작업이 생기고, 결재를 승인하면(주인이 직접 발행) 작업이 끝난다', async () => {
    const agent = await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '브라우저 담당',
      tool: 'claude',
      scopes: ['read_public', 'browse'],
      approvalActions: ['browser.site.publish'],
    });
    assert.equal(agent.status, 201, agent.text);
    const site = await newSite();
    const asked = await api.request('POST', `${SITES}/${site.id}/tasks`, owner, {
      requestId: randomUUID(),
      instruction: '이 소재로 글을 채워 주세요',
    });
    assert.ok([200, 201, 202].includes(asked.status), asked.text);
    await drain();

    const next = await api.mcp(runner, 'tools/call', {
      name: 'next_jobs',
      arguments: { tools: ['claude'], own_logins: ['claude'], browser: true, limit: 5 },
    });
    const jobs = (next.json().result as { structuredContent: { jobs: Json[] } }).structuredContent
      .jobs;
    const job = jobs.find((j) => (j.task as Json).kind === 'browse');
    assert.ok(job, 'browser를 알린 러너가 browse 작업을 받는다');
    const payload = (job.task as Json).payload as { site: Json };
    assert.deepEqual(payload.site, {
      id: site.id,
      version: site.version,
      name: SITE.name,
      startUrl: SITE.startUrl,
      origins: SITE.origins,
    });
    assert.match(String((job.task as Json).title), /^시험 블로그: 이 소재로 글을 채워 주세요/);

    const approval = await tool(String(job.run_token), 'request_approval', {
      request_id: 'publish-1',
      action: 'browser.site.publish',
      target_kind: 'browser_site',
      target_id: site.id,
      target_version: site.version,
      note: '편집기를 채웠어요. 오른쪽 위 발행 버튼',
    });
    assert.equal(approval.ok, true, JSON.stringify(approval.body));
    const pending = (await api.get(`/api/approvals/${approval.body.approval_id}`, owner)).json();
    const decided = await api.request('POST', `/api/approvals/${pending.id}/decide`, owner, {
      version: pending.version,
      decision: 'approve',
    });
    assert.equal(decided.status, 200, decided.text);
    await drain();
    const task = (await api.get(`/api/tasks/${(job.task as Json).id}`, owner)).json();
    assert.equal(
      task.status,
      'done',
      '패키지가 결과를 남겨 작업이 끝났다 (서버는 발행하지 않는다)',
    );
  });
});
