import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import { Database } from '../../platform';

// /api/runner-skills: 보는 사람별 결과 (방문자 · write 기기 · 주인), 콘솔 판 쌓기 · 되돌리기,
// 그리고 next_jobs가 지금 쓰는 판을 러너에게 실어 보내는지.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** write 권한을 준 기기의 Bearer 머리글. 관리 일은 이 기기에게도 막혀야 한다 */
let writer: Readonly<Record<string, string>>;

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  writer = { authorization: `Bearer ${await api.writeDevice(owner, 'skill-writer')}` };
});
after(() => api.close());

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const detail = async (name: string): Promise<Json> =>
  ok(await api.get(`/api/runner-skills/${name}`, owner));

/** 저장소 판을 조금 고친 SKILL.md (앞부분은 그대로) */
const edited = (repo: Json, line: string): Json => {
  const files = (repo as { files: Record<string, string> }).files;
  return { ...files, 'SKILL.md': `${files['SKILL.md']}\n${line}\n` };
};

const save = (name: string, files: Json, version: number, more: Json = {}) =>
  api.request('POST', `/api/runner-skills/${name}/revisions`, owner, {
    requestId: randomUUID(),
    files,
    note: '시험',
    version,
    ...more,
  });

describe('누가 쓸 수 있나', () => {
  test('방문자와 write 기기는 스킬을 보지도 고치지도 못한다', async () => {
    assert.equal((await api.get('/api/runner-skills')).status, 403);
    const asWriter = await api.request(
      'GET',
      '/api/runner-skills',
      TestUser.visitor,
      undefined,
      writer,
    );
    assert.equal(asWriter.status, 403);
    const put = await api.request(
      'POST',
      '/api/runner-skills/cairn-write/revisions',
      TestUser.visitor,
      { requestId: randomUUID(), files: {}, version: 0 },
      writer,
    );
    assert.equal(put.status, 403);
  });
});

describe('콘솔 판', () => {
  test('목록은 저장소의 러너 스킬뿐이다 (사람의 AI 도구용 스킬은 없다)', async () => {
    const { skills } = ok(await api.get('/api/runner-skills', owner)) as { skills: Json[] };
    const names = skills.map((s) => s.name);
    for (const name of [
      'cairn-write',
      'cairn-tidy',
      'cairn-browse',
      'cairn-code',
      'cairn-make',
      'cairn-runner',
    ])
      assert.ok(names.includes(name), name);
    assert.equal(names.includes('cairn-save'), false);
    const write = skills.find((s) => s.name === 'cairn-write') as Json;
    assert.equal(write.source, 'repo');
    assert.match(String(write.hash), /^[0-9a-f]{64}$/);
    assert.equal((await api.get('/api/runner-skills/cairn-save', owner)).status, 404);
  });

  test('판을 쌓으면 바로 그 판을 쓰고, 저장소 판이나 앞 판으로 되돌릴 수 있다', async () => {
    const before = await detail('cairn-tidy');
    assert.equal(before.source, 'repo');
    assert.equal(before.version, 0, '콘솔 판이 없으면 0');
    const repo = before.repo as Json;

    const first = ok(await save('cairn-tidy', edited(repo, '첫 판'), 0), 201);
    assert.deepEqual(
      { source: first.source, revision: first.revision, revisions: first.revisions },
      { source: 'console', revision: 1, revisions: 1 },
    );
    const second = ok(
      await save('cairn-tidy', edited(repo, '둘째 판'), Number(first.version)),
      201,
    );
    assert.equal(second.revision, 2);

    const now = await detail('cairn-tidy');
    assert.equal(now.source, 'console');
    assert.match(String((now.files as Json)['SKILL.md']), /둘째 판/);
    assert.deepEqual(
      (now.revisionList as Json[]).map((r) => r.revision),
      [2, 1],
    );
    assert.equal(now.repoChanged, false);

    const back = ok(
      await api.request('PUT', '/api/runner-skills/cairn-tidy/active', owner, {
        revision: 1,
        version: second.version,
      }),
    );
    assert.equal(back.revision, 1);
    const toRepo = ok(
      await api.request('PUT', '/api/runner-skills/cairn-tidy/active', owner, {
        revision: null,
        version: back.version,
      }),
    );
    assert.equal(toRepo.source, 'repo');
    assert.equal((await detail('cairn-tidy')).hash, repo.hash, '저장소 판으로 돌아왔다');
    const one = ok(await api.get('/api/runner-skills/cairn-tidy/revisions/1', owner));
    assert.match(String((one.files as Json)['SKILL.md']), /첫 판/, '앞 판은 그대로 남는다');
  });

  test('같은 requestId는 판 하나. 본 version이 다르면 409', async () => {
    const start = await detail('cairn-browse');
    const repo = start.repo as Json;
    const requestId = randomUUID();
    const once = ok(await save('cairn-browse', edited(repo, '한 번'), 0, { requestId }), 201);
    const again = ok(await save('cairn-browse', edited(repo, '한 번'), 0, { requestId }), 201);
    assert.equal(again.revisions, once.revisions);
    const stale = await save('cairn-browse', edited(repo, '옛 화면'), 0);
    assert.equal(stale.status, 409, stale.text);
  });

  test('파일 규칙을 어기면 422, 모양이 틀리면 400, 없는 판 · 콘솔 판 없는 스킬의 되돌리기는 404', async () => {
    const repo = (await detail('cairn-code')).repo as Json;
    const files = (repo as { files: Record<string, string> }).files;
    const skillMd = files['SKILL.md'] as string;
    for (const [label, bad] of [
      ['다른 이름', { 'SKILL.md': skillMd.replace('name: cairn-code', 'name: cairn-write') }],
      ['러너 표시를 지움', { 'SKILL.md': skillMd.replace('cairn-where: runner\n', '') }],
      ['스크립트', { 'SKILL.md': skillMd, 'scripts/run.sh': 'rm -rf /' }],
      ['폴더 밖', { 'SKILL.md': skillMd, '../x.md': 'x' }],
      ['앞부분 없음', { 'SKILL.md': '# 그냥 글' }],
    ] as const) {
      const res = await save('cairn-code', bad, 0);
      assert.equal(res.status, 422, `${label}: ${res.text}`);
    }
    assert.equal((await save('cairn-code', { 'SKILL.md': 1 } as Json, 0)).status, 400);
    const missing = await api.request('PUT', '/api/runner-skills/cairn-code/active', owner, {
      revision: null,
      version: 1,
    });
    assert.equal(missing.status, 404, '콘솔 판이 없는 스킬');
    const noRevision = await api.request('PUT', '/api/runner-skills/cairn-code/active', owner, {
      version: 1,
    });
    assert.equal(noRevision.status, 400, 'revision을 보내지 않으면 (저장소 판은 null로 보낸다)');
    assert.equal((await api.get('/api/runner-skills/cairn-code/revisions/9', owner)).status, 404);
  });

  test('쌓인 판은 DB도 고치거나 지우지 못한다', async () => {
    await assert.rejects(
      db.sql`UPDATE task.skill_revisions SET note = 'x'`,
      /추가만|append|UPDATE/i,
    );
    await assert.rejects(db.sql`DELETE FROM task.skill_revisions`, /추가만|append|DELETE/i);
  });
});

describe('러너에게 실어 보내기 · 실행 기록', () => {
  let runner: string;
  let agent: Json;

  const mcp = async (name: string, args: Json): Promise<Json> => {
    const res = await api.mcp(runner, 'tools/call', { name, arguments: args });
    const result = res.json().result as { isError?: boolean; structuredContent?: Json };
    assert.equal(result.isError ?? false, false, res.text);
    return result.structuredContent ?? {};
  };

  /** 초안 작업을 하나 만들어 빌린다. 러너는 빌드와 CLI 버전을 알린다 */
  const lease = async (): Promise<Json> => {
    ok(
      await api.request('POST', '/api/tasks', owner, {
        requestId: randomUUID(),
        agentId: agent.id,
        kind: 'draft_post',
        instruction: '초안을 써 주세요',
      }),
      201,
    );
    const { jobs } = (await mcp('next_jobs', {
      tools: ['claude'],
      runner_build: 'abc1234',
      cli_versions: { claude: '2.1.302 (Claude Code)', codex: 'codex-cli 0.164.0' },
    })) as { jobs: Json[] };
    const [job] = jobs;
    assert.ok(job, '빌린 일이 없다');
    return job;
  };
  const runsOf = async (taskId: unknown): Promise<Json[]> =>
    (ok(await api.get(`/api/tasks/${taskId}`, owner)).runs as Json[]) ?? [];

  before(async () => {
    runner = String(
      ok(
        await api.request('POST', '/api/devices/runner', owner, {
          requestId: randomUUID(),
          name: 'skill-runner',
        }),
        201,
      ).token,
    );
    ok(
      await api.request('PUT', '/api/ai/claude/token', owner, {
        token: `sk-ant-oat01-${randomUUID()}`,
      }),
    );
    agent = ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: '글쓰기',
        tool: 'claude',
        scopes: ['read_public', 'write'],
      }),
      201,
    );
  });

  test('next_jobs는 지금 쓰는 판(콘솔 판이 있으면 그것)을 파일까지 실어 보낸다', async () => {
    const repoJob = await lease();
    assert.equal(repoJob.skill, 'cairn-write');
    const repoPackage = repoJob.skill_package as Json;
    assert.equal(repoPackage.source, 'repo');
    assert.equal(repoPackage.revision, null);
    assert.match(String((repoPackage.files as Json)['SKILL.md']), /name: cairn-write/);

    const repo = (await detail('cairn-write')).repo as Json;
    ok(await save('cairn-write', edited(repo, '콘솔에서 더한 규칙'), 0), 201);
    const consoleJob = await lease();
    const consolePackage = consoleJob.skill_package as Json;
    assert.equal(consolePackage.source, 'console');
    assert.equal(consolePackage.revision, 1);
    assert.match(String((consolePackage.files as Json)['SKILL.md']), /콘솔에서 더한 규칙/);
    assert.equal(consolePackage.hash, (await detail('cairn-write')).hash);
  });

  test('빌릴 때마다 실행 기록: 에이전트 설정 판 · 스킬 판 · 러너 빌드 · CLI. 모델은 첫 보고가 한 번 채운다', async () => {
    const job = await lease();
    const taskId = (job.task as Json).id;
    const [run] = await runsOf(taskId);
    assert.ok(run, '실행 기록이 없다');
    assert.equal(run.seq, 1);
    assert.equal(run.agentRevision, 1);
    assert.deepEqual(run.skill, {
      name: 'cairn-write',
      source: 'console',
      revision: 1,
      hash: (job.skill_package as Json).hash,
    });
    assert.equal(run.runnerBuild, 'abc1234');
    assert.equal(run.cliVersion, '2.1.302 (Claude Code)', '에이전트의 도구 것만');
    assert.equal(run.model, null);

    await mcp('report_progress', { task_id: taskId, events: [], model: 'claude-test-1' });
    await mcp('report_progress', { task_id: taskId, events: [], model: 'claude-test-2' });
    assert.equal((await runsOf(taskId))[0]?.model, 'claude-test-1', '처음 알린 모델만');
    await assert.rejects(
      db.sql`UPDATE task.task_runs SET runner_build = 'x' WHERE task_id = ${String(taskId)}`,
      /바꿀 수 없어요/,
    );
    await assert.rejects(db.sql`DELETE FROM task.task_runs WHERE task_id = ${String(taskId)}`);
  });

  test('지시문 틀(cairn-runner)도 일마다 실려 가고 실행 기록에 남는다. 콘솔 판은 저장소 판과 틀 이름 · 자리가 맞아야 한다', async () => {
    const repoJob = await lease();
    const repoPrompt = repoJob.prompt_package as Json;
    assert.equal(repoPrompt.name, 'cairn-runner');
    assert.equal(repoPrompt.source, 'repo');
    const prompts = String((repoPrompt.files as Json)['references/prompts.md']);
    assert.match(prompts, /<!-- intro -->/);
    const [repoRun] = await runsOf((repoJob.task as Json).id);
    assert.deepEqual(repoRun?.prompt, { source: 'repo', revision: null, hash: repoPrompt.hash });

    const files = ((await detail('cairn-runner')).repo as { files: Json }).files;
    const withPrompts = (text: string): Json => ({ ...files, 'references/prompts.md': text });
    for (const [label, text, said] of [
      [
        '틀 이름을 바꿈',
        prompts.replace('<!-- intro -->', '<!-- hello -->'),
        /틀이 빠졌어요: intro/,
      ],
      [
        '없는 자리',
        prompts.replace('# 할 일: {{title}}', '# 할 일: {{title}} {{secret}}'),
        /task 틀에 없는 자리예요/,
      ],
      [
        '닫지 않은 구역',
        prompts.replace('{{/role}}', ''),
        /intro 틀의 \{\{#role\}\}가 닫히지 않았어요/,
      ],
      ['없는 틀', `${prompts}\n<!-- extra -->\n더`, /저장소 판에 없는 틀이에요: extra/],
    ] as const) {
      const res = await save('cairn-runner', withPrompts(text), 0);
      assert.equal(res.status, 422, `${label}: ${res.text}`);
      assert.match(res.text, said, label);
    }

    const saved = ok(
      await save(
        'cairn-runner',
        withPrompts(prompts.replace('# 할 일: {{title}}', '# 맡은 일: {{title}}')),
        0,
      ),
      201,
    );
    const consoleJob = await lease();
    const consolePrompt = consoleJob.prompt_package as Json;
    assert.equal(consolePrompt.source, 'console');
    assert.equal(consolePrompt.revision, 1);
    assert.match(
      String((consolePrompt.files as Json)['references/prompts.md']),
      /# 맡은 일: \{\{title\}\}/,
    );
    const [consoleRun] = await runsOf((consoleJob.task as Json).id);
    assert.deepEqual(consoleRun?.prompt, {
      source: 'console',
      revision: 1,
      hash: consolePrompt.hash,
    });
    ok(
      await api.request('PUT', '/api/runner-skills/cairn-runner/active', owner, {
        revision: null,
        version: saved.version,
      }),
    );
  });

  test('에이전트 설정이 바뀌면 설정 판이 오르고, 멈춤 · 다시 시작은 판을 올리지 않는다', async () => {
    const before = ok(await api.get(`/api/agents/${agent.id}/revisions`, owner))
      .revisions as Json[];
    assert.deepEqual(
      before.map((r) => r.revision),
      [1],
    );
    const list = ok(await api.get('/api/agents', owner)).agents as Json[];
    const now = list.find((a) => a.id === agent.id) as Json;
    const changed = ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        role: '글을 짧게 쓴다',
        version: now.version,
      }),
    );
    assert.equal(changed.settingsRevision, 2);
    const same = ok(
      await api.request('PATCH', `/api/agents/${agent.id}`, owner, {
        role: '글을 짧게 쓴다',
        version: changed.version,
      }),
    );
    assert.equal(same.settingsRevision, 2, '같은 값이면 판이 그대로');
    const paused = ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, { version: same.version }),
    );
    assert.equal(paused.settingsRevision, 2);
    ok(
      await api.request('POST', `/api/agents/${agent.id}/resume`, owner, {
        version: paused.version,
      }),
    );
    const after = ok(await api.get(`/api/agents/${agent.id}/revisions`, owner)).revisions as Json[];
    assert.deepEqual(
      after.map((r) => r.revision),
      [2, 1],
    );
    const [latest] = after;
    assert.ok(latest);
    assert.equal((latest.settings as Json).role, '글을 짧게 쓴다');

    const job = await lease();
    assert.equal((await runsOf((job.task as Json).id))[0]?.agentRevision, 2);
    assert.equal((await api.get(`/api/agents/${agent.id}/revisions`)).status, 403, '방문자');
  });
});
