import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ServerRunnerPolicy } from '../modules/account';
import { OutboxWorker } from '../modules/platform';
import { ApiClient, type TestUser } from './api-client';

// 기능 패키지 code-github (코드 작업 4단계): 저장소 등록 · 일 맡기기 · 칸 러너의 토큰 · PR 기록 · 결재 마무리.
// 보는 사람별: 방문자 · write 기기 · 칸이 아닌 러너 · 칸 러너 · 주인. GitHub에는 닿지 않는다 (PR은 칸 러너가 연다).

type Json = Record<string, unknown>;
const BASE = '/api/p/code-github';
const TOKEN = 'github_pat_test_only_0123456789';
const SHA = (n: number) => n.toString(16).padStart(40, 'a');

let api: ApiClient;
let owner: TestUser;
let writer: Readonly<Record<string, string>>;
let runner: string;
let slot: string;
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

async function newRepo(name = `app-${randomUUID().slice(0, 8)}`): Promise<Json> {
  return ok(
    await api.request('POST', `${BASE}/repos`, owner, {
      name,
      url: `https://github.com/me/${name}`,
      base: 'main',
      setup: 'pnpm install --frozen-lockfile',
      checks: ['pnpm check', 'pnpm test'],
    }),
  );
}

/** 저장소에 일을 맡기고 칸 러너가 빌린다. 같은 DB의 다른 시험이 남긴 일이 먼저 올 수 있어 이 일이 올 때까지 */
async function leasedJob(repo: Json, paths = ['src'], agent = agentId): Promise<Json> {
  const asked = ok(
    await api.request('POST', `${BASE}/repos/${repo.id}/tasks`, owner, {
      requestId: randomUUID(),
      instruction: `버그를 고쳐 주세요 ${randomUUID()}`,
      paths,
      agentId: agent,
    }),
  );
  await drain();
  for (let round = 0; round < 20; round++) {
    const next = await tool(slot, 'next_jobs', { wait_seconds: 0, limit: 10, tools: ['claude'] });
    const job = (next.body.jobs as Json[]).find(
      (j) => String((j.task as Json).title).includes(String(repo.name)) && asked.requestId,
    );
    if (job) return job;
  }
  throw new Error('빌린 일이 없다');
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'code-writer')}` };
  const made = await api.request('POST', '/api/devices/runner', owner, {
    requestId: randomUUID(),
    name: '내 러너',
  });
  runner = String(ok(made, 201).token);
  const secret = api.service(ServerRunnerPolicy).codeSecret();
  slot = String(
    ok(await api.request('POST', '/api/devices/code-runner', owner, { secret, slot: '7' })).token,
  );
  ok(
    await api.request('PUT', '/api/ai/claude/token', owner, {
      token: `sk-ant-oat01-${randomUUID()}`,
    }),
  );
  ok(await api.request('POST', '/api/plugins/code-github/enable', owner));
  ok(
    await api.request('PUT', '/api/plugins/code-github/settings', owner, {
      values: { token: TOKEN },
    }),
  );
  agentId = String(
    ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: '코드 담당',
        tool: 'claude',
        scopes: ['read_public', 'code'],
        approvalActions: ['code.pr.merge'],
      }),
      201,
    ).id,
  );
});
after(() => api.close());

describe('code-github: 저장소와 일 맡기기 (주인)', () => {
  test('방문자 · write 기기는 저장소 · PR을 보지도 바꾸지도 못한다', async () => {
    for (const headers of [{}, writer]) {
      for (const [method, path] of [
        ['GET', `${BASE}/repos`],
        ['POST', `${BASE}/repos`],
        ['GET', `${BASE}/pulls`],
      ] as const) {
        const res = await fetch(`${api.baseUrl}${path}`, {
          method,
          headers: { 'content-type': 'application/json', ...headers },
          body:
            method === 'POST'
              ? JSON.stringify({ name: 'x', url: 'https://github.com/a/b' })
              : undefined,
        });
        assert.equal(res.status, 403, `${method} ${path}`);
      }
    }
  });

  test('등록 · 고치기 · 보관: 주소 규칙, 같은 주소는 하나, 판이 다르면 409, 주소는 바꾸지 않는다', async () => {
    const repo = await newRepo();
    assert.equal(repo.base, 'main');
    assert.deepEqual(repo.checks, ['pnpm check', 'pnpm test']);
    for (const url of [
      'https://user:pw@github.com/me/x',
      'http://github.com/me/x',
      'https://github.com/me',
      'ftp://github.com/me/x',
    ]) {
      const res = await api.request('POST', `${BASE}/repos`, owner, { name: 'x', url });
      assert.equal(res.status, 422, `${url}: ${res.text}`);
    }
    const twice = await api.request('POST', `${BASE}/repos`, owner, { name: 'y', url: repo.url });
    assert.equal(twice.status, 409, twice.text);

    const fixed = ok(
      await api.request('PATCH', `${BASE}/repos/${repo.id}`, owner, {
        version: repo.version,
        setup: '',
        checks: ['npm test'],
        url: 'https://github.com/other/repo',
      }),
    );
    assert.deepEqual([fixed.setup, fixed.checks, fixed.url], ['', ['npm test'], repo.url]);
    const stale = await api.request('PATCH', `${BASE}/repos/${repo.id}`, owner, {
      version: repo.version,
      name: '옛 판',
    });
    assert.equal(stale.status, 409, stale.text);
    const archived = ok(
      await api.request('POST', `${BASE}/repos/${repo.id}/archive`, owner, {
        version: fixed.version,
      }),
    );
    assert.ok(archived.archivedAt);
    const list = ok(await api.get(`${BASE}/repos`, owner)).repos as Json[];
    assert.equal(
      list.some((r) => r.id === repo.id),
      false,
      '보관한 저장소는 목록에 없다',
    );
    const asked = await api.request('POST', `${BASE}/repos/${repo.id}/tasks`, owner, {
      requestId: randomUUID(),
      instruction: '고쳐 주세요',
      paths: ['src'],
    });
    assert.equal(asked.status, 422, '보관한 저장소에는 맡길 수 없다');
  });

  test('일을 맡기면 code 작업이 생기고 그때의 저장소 값이 실린다. 경로는 저장소 안의 상대 경로만', async () => {
    const repo = await newRepo();
    for (const paths of [[], ['/etc'], ['../up'], ['.github/workflows/ci.yml']]) {
      const res = await api.request('POST', `${BASE}/repos/${repo.id}/tasks`, owner, {
        requestId: randomUUID(),
        instruction: '고쳐 주세요',
        paths,
      });
      assert.equal(res.status, 422, `${JSON.stringify(paths)}: ${res.text}`);
    }
    const job = await leasedJob(repo, ['src/', 'docs']);
    const task = job.task as Json;
    assert.equal(task.kind, 'code');
    assert.match(String(task.title), new RegExp(`^${repo.name}: 버그를 고쳐 주세요`));
    assert.deepEqual((task.payload as Json).code, {
      repo: { id: repo.id, url: repo.url, base: 'main' },
      paths: ['src', 'docs'],
      setup: 'pnpm install --frozen-lockfile',
      checks: ['pnpm check', 'pnpm test'],
    });
  });
});

describe('code-github: 칸 러너의 토큰과 PR, 결재', () => {
  test('토큰은 그 작업의 임대를 쥔 칸 러너만 받는다', async () => {
    const repo = await newRepo();
    const job = await leasedJob(repo);
    const taskId = (job.task as Json).id;
    const notSlot = await tool(runner, 'code_credential', { task_id: taskId });
    assert.equal(notSlot.ok, false, '칸이 아닌 러너');
    const unknown = await tool(slot, 'code_credential', { task_id: randomUUID() });
    assert.equal(unknown.ok, false, '쥐지 않은 작업');
    const credential = await tool(slot, 'code_credential', { task_id: taskId });
    assert.equal(credential.ok, true, JSON.stringify(credential.body));
    assert.deepEqual(credential.body, {
      token: TOKEN,
      api_url: 'https://api.github.com',
      pull: null,
    });
    const ownerList = JSON.stringify(ok(await api.get(`${BASE}/repos`, owner)));
    assert.equal(ownerList.includes(TOKEN), false, '콘솔에는 토큰이 나가지 않는다');
  });

  test('PR을 남기면 판 1, 같은 head면 그대로, head가 바뀌면 판이 오른다. 다시 받은 토큰에는 이미 연 PR이 실린다', async () => {
    const repo = await newRepo();
    const job = await leasedJob(repo);
    const taskId = String((job.task as Json).id);
    const opened = (head: string, branch = `cairn/${taskId}`) =>
      tool(slot, 'code_pull_opened', {
        task_id: taskId,
        number: 12,
        url: `https://github.com/me/${repo.name}/pull/12`,
        branch,
        head_sha: head,
        checks: [{ command: 'pnpm check', ok: true }],
      });
    assert.equal((await opened(SHA(1), 'cairn/other')).ok, false, '그 작업의 브랜치만');
    const first = await opened(SHA(1));
    assert.equal(first.body.version, 1);
    assert.equal((await opened(SHA(1))).body.version, 1);
    const second = await opened(SHA(2));
    assert.deepEqual([second.body.pull_id, second.body.version], [first.body.pull_id, 2]);
    const credential = await tool(slot, 'code_credential', { task_id: taskId });
    assert.deepEqual(credential.body.pull, { number: 12, branch: `cairn/${taskId}` });
    const pull = ok(await api.get(`${BASE}/pulls/${first.body.pull_id}`, owner));
    assert.deepEqual(
      [pull.repoName, pull.number, pull.headSha, pull.status],
      [repo.name, 12, SHA(2), 'open'],
    );
  });

  test('승인하면 판이 같을 때 머지로 남기고 작업이 끝난다. 판이 다르면 실패로 끝난다', async () => {
    for (const [stale, expected] of [
      [false, 'done'],
      [true, 'failed'],
    ] as const) {
      const repo = await newRepo();
      const job = await leasedJob(repo);
      const taskId = String((job.task as Json).id);
      const opened = await tool(slot, 'code_pull_opened', {
        task_id: taskId,
        number: 3,
        url: `https://github.com/me/${repo.name}/pull/3`,
        branch: `cairn/${taskId}`,
        head_sha: SHA(3),
        checks: [],
      });
      const approval = await tool(String(job.run_token), 'request_approval', {
        request_id: `merge-${taskId}`,
        action: 'code.pr.merge',
        target_kind: 'pull_request',
        target_id: opened.body.pull_id,
        target_version: stale ? 99 : opened.body.version,
        note: 'draft PR을 열었어요',
      });
      assert.equal(approval.ok, true, JSON.stringify(approval.body));
      const pending = ok(await api.get(`/api/approvals/${approval.body.approval_id}`, owner));
      ok(
        await api.request('POST', `/api/approvals/${pending.id}/decide`, owner, {
          version: pending.version,
          decision: 'approve',
        }),
      );
      await drain();
      const task = ok(await api.get(`/api/tasks/${taskId}`, owner));
      assert.equal(task.status, expected, JSON.stringify(task.result));
      const pull = ok(await api.get(`${BASE}/pulls/${opened.body.pull_id}`, owner));
      assert.equal(pull.status, stale ? 'open' : 'merged');
      if (stale) assert.match(String((task.result as Json).error), /PR이 바뀌었어요/);
    }
  });
});

describe('코드 작업 5단계: 나눠 맡기기와 겹침', () => {
  let lead: string;
  let coder: string;
  /** 두 번째 칸 */
  let slot2: string;

  const newAgent = async (name: string, more: Json = {}) =>
    String(
      ok(
        await api.request('POST', '/api/agents', owner, {
          requestId: randomUUID(),
          name: `${name} ${randomUUID().slice(0, 6)}`,
          tool: 'claude',
          scopes: ['code'],
          approvalActions: ['code.pr.merge'],
          ...more,
        }),
        201,
      ).id,
    );

  const sub = (paths: string[] | undefined, title = `고치기 ${paths?.join(',')}`) => ({
    request_id: randomUUID(),
    to_agent_id: coder,
    kind: 'code',
    title,
    instruction: '맡은 곳을 고쳐 주세요',
    ...(paths ? { paths } : {}),
  });

  /** 칸이 빌린 일 중 이 저장소들의 일 (같은 DB의 다른 시험이 남긴 일은 빼고 본다) */
  async function leaseFrom(token: string, ...repos: Json[]): Promise<Json[]> {
    const next = await tool(token, 'next_jobs', { wait_seconds: 0, limit: 10, tools: ['claude'] });
    assert.equal(next.ok, true, JSON.stringify(next.body));
    const urls = repos.map((r) => r.url);
    return (next.body.jobs as Json[]).filter((j) => urls.includes(codeOf(j).repo.url));
  }

  async function ask(repo: Json, paths: string[], agent: string): Promise<void> {
    ok(
      await api.request('POST', `${BASE}/repos/${repo.id}/tasks`, owner, {
        requestId: randomUUID(),
        instruction: `${paths.join(',')} 고치기`,
        paths,
        agentId: agent,
      }),
    );
    await drain();
  }

  const codeOf = (job: Json) =>
    ((job.task as Json).payload as { code: { paths: string[]; repo: { url: string } } }).code;
  const pathsOf = (job: Json) => codeOf(job).paths;

  before(async () => {
    lead = await newAgent('팀장');
    coder = await newAgent('코더', { reportsTo: lead });
    const secret = api.service(ServerRunnerPolicy).codeSecret();
    slot2 = String(
      ok(await api.request('POST', '/api/devices/code-runner', owner, { secret, slot: '8' })).token,
    );
  });

  test('팀장은 code 일을 경로로 나눠 맡긴다: 하위 작업은 저장소를 물려받고, 겹치거나 밖이거나 경로가 없으면 거절', async () => {
    const repo = await newRepo();
    const job = await leasedJob(repo, ['src', 'docs'], lead);
    const run = String(job.run_token);
    for (const [subtasks, problem] of [
      [[sub(['src']), sub(['src/a'])], /겹쳐요/],
      [[sub(['test'])], /고칠 수 있는 곳 밖/],
      [[sub(undefined)], /paths/],
    ] as const) {
      const refused = await tool(run, 'delegate_task', { subtasks });
      assert.equal(refused.ok, false, JSON.stringify(refused.body));
      assert.match(JSON.stringify(refused.body), problem);
    }

    const done = await tool(run, 'delegate_task', {
      subtasks: [sub(['src/a']), sub(['src/b']), sub(['docs'])],
    });
    assert.equal(done.ok, true, JSON.stringify(done.body));
    assert.equal(done.body.waiting, 'subtasks');
    const made = done.body.subtasks as Json[];
    assert.equal(made.length, 3);
    const child = ok(await api.get(`/api/tasks/${made[0]?.task_id}`, owner));
    const code = (child.payload as Json).code as Json;
    assert.equal(child.kind, 'code');
    assert.deepEqual(code.paths, ['src/a']);
    assert.deepEqual(code.repo, { id: repo.id, url: repo.url, base: 'main' });
    assert.deepEqual(code.checks, ['pnpm check', 'pnpm test']);
    const parent = ok(await api.get(`/api/tasks/${(job.task as Json).id}`, owner));
    assert.equal(parent.status, 'waiting');

    // 하위 작업을 기다리는 팀장은 저장소를 쥐지 않는다: 칸 둘이 하위 작업을 동시에 빌린다
    const first = await leaseFrom(slot, repo);
    const second = await leaseFrom(slot2, repo);
    const leased = [...first, ...second].map(pathsOf).sort();
    assert.deepEqual(leased, [['docs'], ['src/a'], ['src/b']]);
  });

  test('칸은 같은 저장소에서 겹치는 일을 동시에 빌리지 않는다: 도는 동안 · PR 결재를 기다리는 동안', async () => {
    const repo = await newRepo();
    await ask(repo, ['src'], coder);
    await ask(repo, ['src/x'], coder);
    await ask(repo, ['docs'], coder);
    const first = await leaseFrom(slot, repo);
    assert.deepEqual(first.map(pathsOf).sort(), [['docs'], ['src']], '겹치는 src/x는 남는다');
    assert.deepEqual(await leaseFrom(slot2, repo), []);

    const holder = first.find((j) => pathsOf(j)[0] === 'src') as Json;
    const taskId = String((holder.task as Json).id);
    const opened = await tool(slot, 'code_pull_opened', {
      task_id: taskId,
      number: 9,
      url: `https://github.com/me/${repo.name}/pull/9`,
      branch: `cairn/${taskId}`,
      head_sha: SHA(9),
      checks: [],
    });
    const approval = await tool(String(holder.run_token), 'request_approval', {
      request_id: `merge-${taskId}`,
      action: 'code.pr.merge',
      target_kind: 'pull_request',
      target_id: opened.body.pull_id,
      target_version: opened.body.version,
      note: 'draft PR',
    });
    assert.equal(approval.ok, true, JSON.stringify(approval.body));
    assert.deepEqual(await leaseFrom(slot2, repo), [], 'PR이 열린 동안에도 기다린다');

    const pending = ok(await api.get(`/api/approvals/${approval.body.approval_id}`, owner));
    ok(
      await api.request('POST', `/api/approvals/${pending.id}/decide`, owner, {
        version: pending.version,
        decision: 'approve',
      }),
    );
    await drain();
    assert.equal(ok(await api.get(`/api/tasks/${taskId}`, owner)).status, 'done');
    assert.deepEqual(
      (await leaseFrom(slot2, repo)).map(pathsOf),
      [['src/x']],
      '머지한 뒤에 빌린다',
    );
  });

  test('다른 저장소는 경로가 같아도 막지 않는다', async () => {
    const a = await newRepo();
    const b = await newRepo();
    await ask(a, ['.'], coder);
    await ask(b, ['.'], coder);
    const leased = await leaseFrom(slot, a, b);
    assert.deepEqual(leased.map((j) => codeOf(j).repo.url).sort(), [a.url, b.url].sort());
  });
});
