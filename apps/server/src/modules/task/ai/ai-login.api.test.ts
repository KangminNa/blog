import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ApiClient, type ApiResult, TestUser } from '../../../testing/api-client';
import {
  AgentActor,
  Database,
  DeviceActor,
  Forbidden,
  OwnerActor,
  SecretBox,
  SecretRotation,
  SystemActor,
  VisitorActor,
} from '../../platform';
import { TaskService } from '../task/task.service';
import { AiLoginInput } from './ai-login.input';
import { AiLoginQuery } from './ai-login.query';
import { AiLoginService } from './ai-login.service';

// AI 메뉴와 ai_login. 주인은 REST로, 러너는 MCP로 들어온다. 토큰이 어디로도 새지 않는지를 함께 본다.

type Json = Record<string, unknown>;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한만 가진 기기 (러너) */
let runner: string;
/** 기본 권한만 있는 기기 */
let laptop: string;

const newToken = (): string => `sk-ant-oat01-${randomUUID()}`;
const cliActor = new OwnerActor('local', 'cli');

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

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
  assert.equal(res.status, 200, res.text);
  return (res.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
}

const claude = async (): Promise<Json> =>
  (ok(await api.get('/api/ai', owner)) as { tools: Json[] }).tools[0] as Json;

const saveToken = async (token: string): Promise<Json> =>
  ok(await api.request('PUT', '/api/ai/claude/token', owner, { token }));

const startTest = async (): Promise<Json> =>
  ok(await api.request('POST', '/api/ai/claude/test', owner));

const getTask = async (id: unknown): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));

async function newAgent(): Promise<Json> {
  return ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      tool: 'claude',
      scopes: ['read_public', 'write'],
    }),
    201,
  );
}

async function newTask(agent: Json | null): Promise<Json> {
  return ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent?.id ?? null,
      instruction: '글을 써 주세요',
    }),
    201,
  );
}

/** 러너가 빌린 일들 */
async function lease(limit = 1): Promise<Json[]> {
  const { ok: done, body } = await tool(runner, 'next_jobs', { limit });
  assert.equal(done, true, JSON.stringify(body));
  return body.jobs as Json[];
}

const submit = (taskId: unknown, status: string, error?: string) =>
  tool(runner, 'submit_result', {
    task_id: taskId,
    request_id: randomUUID(),
    status,
    ...(error ? { error } : {}),
  });

/** 러너의 다음 일. 앞 테스트의 일은 beforeEach가 치운다 */
async function takeTest(): Promise<Json> {
  const [job] = await lease();
  assert.ok(job, '빌린 일이 없다');
  assert.equal((job.task as Json).kind, 'ai_test');
  return job;
}

before(async () => {
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: 'AI', siteUrl: api.baseUrl, version });
  runner = await api.connectDevice(owner, 'ai-runner');
  laptop = await api.connectDevice(owner, 'ai-laptop');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'ai-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: ['run'],
      version: device?.version,
    }),
  );
});

/** 테스트마다 토큰을 넣기 전으로, 일을 비운 채로 */
beforeEach(async () => {
  await db.sql`DELETE FROM task.ai_logins`;
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
  await db.sql`UPDATE task.agents SET status = 'paused'`;
});

after(async () => {
  await api.close();
});

describe('누가 쓸 수 있나', () => {
  test('방문자는 AI 메뉴를 쓸 수 없다', async () => {
    assert.equal((await api.get('/api/ai')).status, 403);
    const put = await api.request('PUT', '/api/ai/claude/token', TestUser.visitor, {
      token: newToken(),
    });
    assert.equal(put.status, 403);
    const test = await api.request('POST', '/api/ai/claude/test', TestUser.visitor);
    assert.equal(test.status, 403);
  });

  test('기기는 write 권한이 있어도 주인의 일을 할 수 없다', async () => {
    const headers = { authorization: `Bearer ${laptop}` };
    const get = await api.request('GET', '/api/ai', TestUser.visitor, undefined, headers);
    assert.equal(get.status, 403);
    assert.equal(get.json().scope, 'owner');
    const put = await api.request(
      'PUT',
      '/api/ai/claude/token',
      TestUser.visitor,
      { token: newToken() },
      headers,
    );
    assert.equal(put.status, 403);
    const test = await api.request(
      'POST',
      '/api/ai/claude/test',
      TestUser.visitor,
      undefined,
      headers,
    );
    assert.equal(test.status, 403);
  });

  test('주인은 넣기 전의 상태를 본다', async () => {
    const empty = {
      connected: false,
      expiresAt: null,
      checkedAt: null,
      lastError: null,
      signin: null,
    };
    assert.deepEqual(ok(await api.get('/api/ai', owner)), {
      tools: [
        { tool: 'claude', ...empty },
        { tool: 'codex', ...empty },
      ],
    });
  });
});

describe('토큰 넣기', () => {
  test('모양이 틀리면 400이고 문구에 값을 넣지 않는다', async () => {
    const put = (token: unknown) =>
      api.request('PUT', '/api/ai/claude/token', owner, { token } as Json);

    const other = await put('sk-ant-api03-secret-value');
    assert.equal(other.status, 400);
    assert.match(String((other.json().fields as Json).token), /sk-ant-oat/);
    assert.equal(other.text.includes('secret-value'), false);

    // 터미널에서 줄이 접힌 채 복사한 토큰
    const wrapped = await put('sk-ant-oat01-first\n  second-part');
    assert.equal(wrapped.status, 400);
    assert.match(String((wrapped.json().fields as Json).token), /한 줄로/);
    assert.equal(wrapped.text.includes('second-part'), false);

    for (const bad of ['sk-ant-oat01-a b', ' sk-ant-oat01-a', '', 7, undefined])
      assert.equal((await put(bad)).status, 400, String(bad));
    assert.equal((await claude()).connected, false, '저장되지 않았다');
  });

  test('저장하면 1년 뒤 만료로 연결되고, 토큰은 어느 응답에도 없다', async () => {
    const token = newToken();
    const saved = await api.request('PUT', '/api/ai/claude/token', owner, { token });
    assert.equal(saved.status, 200);
    assert.equal(saved.text.includes(token), false);
    assert.deepEqual(Object.keys(saved.json()).sort(), [
      'checkedAt',
      'connected',
      'expiresAt',
      'lastError',
      'signin',
      'tool',
    ]);

    const seen = await api.get('/api/ai', owner);
    assert.equal(seen.text.includes(token), false);
    const state = await claude();
    assert.equal(state.connected, true);
    assert.equal(state.checkedAt, null, '확인 전');
    assert.equal(state.lastError, null);
    const inYear = new Date();
    inYear.setUTCFullYear(inYear.getUTCFullYear() + 1);
    const gap = Math.abs(new Date(String(state.expiresAt)).getTime() - inYear.getTime());
    assert.ok(gap < 60_000, `만료가 1년 뒤가 아니다: ${state.expiresAt}`);
  });

  test('DB에는 암호문만 있다', async () => {
    const token = newToken();
    await saveToken(token);
    const [row] = await db.sql`SELECT secret, nonce FROM task.ai_logins`;
    assert.equal(Buffer.from(row?.secret).toString('utf8').includes(token), false);
    assert.equal(Buffer.from(row?.nonce).length, 12);
  });

  test('바꾸면 한 줄이 그대로이고 앞 토큰의 확인 결과는 사라진다', async () => {
    await saveToken(newToken());
    await db.sql`
      UPDATE task.ai_logins SET checked_at = now(), last_error = '실패', expires_at = now() + interval '1 day'`;

    const second = newToken();
    const state = await saveToken(second);

    assert.equal(state.checkedAt, null);
    assert.equal(state.lastError, null);
    assert.ok(new Date(String(state.expiresAt)).getTime() > Date.now() + 300 * 86_400_000);
    const rows = await db.sql`SELECT id FROM task.ai_logins`;
    assert.equal(rows.length, 1);
    assert.equal((await tool(runner, 'ai_login', { tool: 'claude' })).body.token, second);
  });

  test('처음 넣는 저장이 동시에 와도 한 줄이다', async () => {
    const answers = await Promise.all(
      [newToken(), newToken(), newToken()].map((token) =>
        api.request('PUT', '/api/ai/claude/token', owner, { token }),
      ),
    );
    for (const res of answers) assert.equal(res.status, 200, res.text);
    assert.equal((await db.sql`SELECT id FROM task.ai_logins`).length, 1);
  });
});

describe('ai_login', () => {
  test('run 권한을 가진 기기가 토큰과 만료를 받는다', async () => {
    const token = newToken();
    const saved = await saveToken(token);

    const { ok: done, body } = await tool(runner, 'ai_login', { tool: 'claude' });

    assert.equal(done, true, JSON.stringify(body));
    assert.deepEqual(body, { token, expires_at: saved.expiresAt, version: 1 });
  });

  test('run 권한이 없는 기기에게는 보이지 않고 부를 수도 없다', async () => {
    await saveToken(newToken());
    assert.equal((await toolNames(laptop)).includes('ai_login'), false);
    const asked = await tool(laptop, 'ai_login', { tool: 'claude' });
    assert.equal(asked.ok, false);
    assert.equal(JSON.stringify(asked.body).includes('sk-ant-'), false);
  });

  test('에이전트의 작업 토큰은 보지도 부르지도 못한다', async () => {
    const token = newToken();
    await saveToken(token);
    const agent = await newAgent();
    await newTask(agent);
    const [job] = await lease();
    const runToken = String(job?.run_token);
    assert.match(runToken, /^cairn_run_/);

    assert.equal((await toolNames(runToken)).includes('ai_login'), false);
    const asked = await api.mcp(runToken, 'tools/call', {
      name: 'ai_login',
      arguments: { tool: 'claude' },
    });
    assert.equal(asked.text.includes(token), false);
    assert.ok(asked.text.includes('isError') || asked.status !== 200, asked.text);
  });

  test('run이 적힌 작업 토큰이 있다고 해도, 기기가 아니면 받지 못한다', async () => {
    await saveToken(newToken());
    const [row] = await db.sql`SELECT space_id FROM task.ai_logins`;
    const space = String(row?.space_id);
    const forged = new AgentActor(space, randomUUID(), randomUUID(), new Set(['run']));
    const input = AiLoginInput.from({ tool: 'claude' });
    const logins = api.service(AiLoginQuery);

    await assert.rejects(logins.token(forged, input), Forbidden);
    await assert.rejects(logins.token(new VisitorActor(), input), Forbidden);
    await assert.rejects(logins.token(new OwnerActor(space, 'me'), input), Forbidden);
  });

  test('넣지 않았거나 만료된 토큰은 이유와 함께 거절한다', async () => {
    const none = await tool(runner, 'ai_login', { tool: 'claude' });
    assert.equal(none.ok, false);
    assert.equal(none.body.code, 'rule_violation');
    assert.match(String(none.body.message), /AI 메뉴/);

    const token = newToken();
    await saveToken(token);
    await db.sql`UPDATE task.ai_logins SET expires_at = now() - interval '1 minute'`;
    const expired = await tool(runner, 'ai_login', { tool: 'claude' });
    assert.equal(expired.ok, false);
    assert.equal(expired.body.code, 'rule_violation');
    assert.match(String(expired.body.message), /만료/);
    assert.equal(JSON.stringify(expired.body).includes(token), false);
    assert.equal((await claude()).connected, false);
  });
});

describe('연결 확인', () => {
  test('토큰을 넣기 전이나 만료된 뒤에는 맡지 않는다', async () => {
    const res = await api.request('POST', '/api/ai/claude/test', owner);
    assert.equal(res.status, 422);
    await saveToken(newToken());
    await db.sql`UPDATE task.ai_logins SET expires_at = now() - interval '1 minute'`;
    assert.equal((await api.request('POST', '/api/ai/claude/test', owner)).status, 422);
    assert.deepEqual(await lease(), []);
  });

  test('여러 번 눌러도 기다리는 확인은 하나고, 끝나면 새로 맡는다', async () => {
    await saveToken(newToken());
    const answers = await Promise.all([startTest(), startTest(), startTest()]);
    assert.equal(new Set(answers.map((a) => a.taskId)).size, 1);
    assert.equal(answers[0]?.status, 'queued');

    const job = await takeTest();
    assert.equal((job.task as Json).id, answers[0]?.taskId);
    const during = await startTest();
    assert.equal(during.taskId, answers[0]?.taskId, '도는 중에도 같다');
    assert.equal(during.status, 'running');
    assert.deepEqual(await lease(), [], '둘이 되지 않았다');

    await submit(during.taskId, 'done');
    assert.notEqual((await startTest()).taskId, during.taskId);
  });

  test('일을 받을 에이전트가 없어도 빌려 주고, 작업 토큰은 없다', async () => {
    await saveToken(newToken());
    await newTask(null);
    const { taskId } = await startTest();

    const jobs = await lease(5);

    assert.equal(jobs.length, 1, '담당 없는 보통 일은 그대로 기다린다');
    const job = jobs[0] as Json;
    assert.equal((job.task as Json).id, taskId);
    assert.deepEqual((job.task as Json).payload, { tool: 'claude', loginVersion: 1 });
    assert.equal(job.agent, null);
    assert.equal(job.run_token, null);
    assert.ok(String(job.instruction).length > 0);
    assert.equal((await getTask(taskId)).agentId, null);
  });

  test('일을 받을 에이전트가 있어도 담당을 정하지 않고, 쌓인 일보다 먼저 돈다', async () => {
    await saveToken(newToken());
    const agent = await newAgent();
    await newTask(agent);
    const { taskId } = await startTest();

    const first = await takeTest();

    assert.equal((first.task as Json).id, taskId);
    assert.equal(first.agent, null);
    assert.equal((await getTask(taskId)).agentId, null);
    const next = (await lease())[0] as Json;
    assert.equal((next.agent as Json).id, agent.id, '뒤의 일은 그대로 에이전트가 맡는다');
    assert.match(String(next.run_token), /^cairn_run_/);
  });

  test('성공하면 확인 시각을 남기고 앞의 오류를 지운다', async () => {
    const token = newToken();
    await saveToken(token);
    await startTest();
    await db.sql`UPDATE task.ai_logins SET last_error = '앞의 실패'`;
    const job = await takeTest();

    const before = Date.now();
    await submit((job.task as Json).id, 'done');

    const state = await claude();
    assert.ok(new Date(String(state.checkedAt)).getTime() >= before - 1000);
    assert.equal(state.lastError, null);
    assert.equal(JSON.stringify(await getTask((job.task as Json).id)).includes(token), false);
  });

  test('실패하면 이유를 남긴다', async () => {
    await saveToken(newToken());
    const { taskId } = await startTest();
    await takeTest();

    await submit(taskId, 'failed', 'AI CLI가 코드 1로 끝났어요: 맞지 않는 토큰');

    const state = await claude();
    assert.ok(state.checkedAt);
    assert.equal(state.connected, true, '토큰은 그대로 있다');
    assert.match(String(state.lastError), /맞지 않는 토큰/);
  });

  test('도는 사이 토큰을 바꾸면 옛 토큰의 결과를 적지 않는다', async () => {
    await saveToken(newToken());
    const { taskId } = await startTest();
    await takeTest();
    await saveToken(newToken());

    await submit(taskId, 'done');

    assert.equal((await getTask(taskId)).status, 'done');
    assert.equal((await claude()).checkedAt, null, '새 토큰은 확인 전이다');
  });

  test('러너가 사라져 임대가 세 번 끝나면 실패로 남긴다', async () => {
    await saveToken(newToken());
    const { taskId } = await startTest();
    await takeTest();
    await db.sql`
      UPDATE task.tasks SET attempts = 3, lease_until = now() - interval '1 minute'
      WHERE id = ${String(taskId)}`;

    await api.service(TaskService).reclaim(new SystemActor());

    assert.equal((await getTask(taskId)).status, 'failed');
    assert.match(String((await claude()).lastError), /임대/);
  });

  test('임대가 한 번 끝난 확인은 다시 돈다', async () => {
    await saveToken(newToken());
    const { taskId } = await startTest();
    await takeTest();
    await db.sql`
      UPDATE task.tasks SET lease_until = now() - interval '1 minute' WHERE id = ${String(taskId)}`;

    await api.service(TaskService).reclaim(new SystemActor());

    assert.equal((await getTask(taskId)).status, 'queued');
    assert.equal((await claude()).checkedAt, null);
  });

  test('러너가 돌려준 확인은 끝난 것이 아니다', async () => {
    await saveToken(newToken());
    const { taskId } = await startTest();
    await takeTest();

    await tool(runner, 'release_job', { task_id: taskId, reason: '러너가 멈춰요' });

    assert.equal((await getTask(taskId)).status, 'queued');
    assert.equal((await claude()).checkedAt, null);
    assert.equal((await startTest()).taskId, taskId);
  });

  test('주인이 취소한 확인은 결과를 남기지 않고 다시 맡을 수 있다', async () => {
    await saveToken(newToken());
    const { taskId } = await startTest();
    const { version } = await getTask(taskId);
    ok(await api.request('POST', `/api/tasks/${taskId}/cancel`, owner, { version }));

    assert.equal((await claude()).checkedAt, null);
    assert.notEqual((await startTest()).taskId, taskId);
  });
});

describe('서버 키 교체', () => {
  test('다시 잠가도 러너가 같은 토큰을 받고, 확인 결과는 그대로다', async () => {
    const token = newToken();
    await saveToken(token);
    await db.sql`UPDATE task.ai_logins SET checked_at = now(), last_error = '실패'`;
    const counts = await api.service(SecretRotation).run(cliActor);
    assert.equal(counts.get('task.ai_logins'), 0, '등록되어 있고, 이미 지금 키다');

    const oldKey = String(process.env.CAIRN_SECRET_KEY);
    const newKey = SecretBox.newKey();
    const rotating = SecretBox.fromEnv({ CAIRN_SECRET_KEY: newKey, CAIRN_SECRET_KEY_OLD: oldKey });
    const finished = SecretBox.fromEnv({ CAIRN_SECRET_KEY: newKey });
    const [before] = await db.sql`SELECT secret, space_id FROM task.ai_logins`;

    const service = new AiLoginService(db, rotating, new AiLoginQuery(db, rotating));
    assert.equal(await service.resealSecrets(cliActor), 1);
    assert.equal(await service.resealSecrets(cliActor), 0, '두 번째는 할 일이 없다');
    await assert.rejects(service.resealSecrets(new VisitorActor()), Forbidden);

    const [after] = await db.sql`SELECT secret FROM task.ai_logins`;
    assert.notDeepEqual(after?.secret, before?.secret);
    const device = new DeviceActor(String(before?.space_id), randomUUID(), new Set(['run']));
    const input = AiLoginInput.from({ tool: 'claude' });
    const view = await new AiLoginQuery(db, finished).token(device, input);
    assert.equal(view.token, token, '옛 키를 지운 뒤에도 풀린다');
    assert.ok((await claude()).checkedAt);
    assert.equal((await claude()).lastError, '실패');
  });

  test('풀리지 않는 값이 있으면 아무것도 바꾸지 않는다', async () => {
    await saveToken(newToken());
    const [before] = await db.sql`SELECT secret FROM task.ai_logins`;
    const stranger = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });

    await assert.rejects(
      new AiLoginService(db, stranger, new AiLoginQuery(db, stranger)).resealSecrets(cliActor),
      /풀 수 없어요/,
    );

    const [after] = await db.sql`SELECT secret FROM task.ai_logins`;
    assert.deepEqual(after?.secret, before?.secret);
  });
});

describe('웹 로그인 (러너가 로그인 명령을 대신 돌린다)', () => {
  // 같은 DB를 쓰는 다른 테스트 파일(사용량 등)에 Codex 에이전트가 보이지 않게 되돌린다
  after(async () => {
    await db.sql`UPDATE task.agents SET tool = 'claude' WHERE tool = 'codex'`;
  });

  const CLAUDE_URL =
    'https://claude.ai/oauth/authorize?code=true&client_id=abc&response_type=code&state=s123';
  const CODEX_URL = 'https://auth.openai.com/codex/device';
  const AUTH_JSON = JSON.stringify({ tokens: { refresh_token: 'r', access_token: 'a' } });

  const start = async (tool: string): Promise<Json> =>
    ok(await api.request('POST', `/api/ai/${tool}/signin`, owner));
  const signinOf = async (tool: string): Promise<Json | null> => {
    const { tools } = ok(await api.get('/api/ai', owner)) as { tools: Json[] };
    return (tools.find((t) => t.tool === tool)?.signin as Json | null) ?? null;
  };
  const relay = (taskId: unknown, args: Json = {}, token = runner) =>
    tool(token, 'ai_signin', { task_id: taskId, ...args });
  const pasteCode = (taskId: unknown, code: string) =>
    api.request('POST', '/api/ai/claude/signin/code', owner, { taskId, code });

  /** 러너가 웹 로그인 일을 빌린다 */
  async function takeSignin(tool: string): Promise<Json> {
    const [job] = await lease();
    assert.ok(job, '빌린 일이 없다');
    const task = job.task as Json;
    assert.equal(task.kind, 'ai_signin');
    assert.equal((task.payload as Json).tool, tool);
    assert.equal(job.agent, null, '에이전트도');
    assert.equal(job.run_token, null, '작업 토큰도 없다');
    return task;
  }

  test('방문자와 write 기기는 로그인을 시작하거나 코드를 넣지 못한다', async () => {
    const asWho: Readonly<Record<string, string>>[] = [{}, { authorization: `Bearer ${laptop}` }];
    for (const headers of asWho) {
      const begin = await api.request(
        'POST',
        '/api/ai/claude/signin',
        TestUser.visitor,
        undefined,
        headers,
      );
      assert.equal(begin.status, 403);
      const code = await api.request(
        'POST',
        '/api/ai/claude/signin/code',
        TestUser.visitor,
        { taskId: randomUUID(), code: 'abcd' },
        headers,
      );
      assert.equal(code.status, 403);
    }
    assert.equal(
      (await toolNames(laptop)).includes('ai_signin'),
      false,
      'run 권한이 없으면 도구도 없다',
    );
  });

  test('Claude: 주소를 보이고, 붙여 넣은 코드를 러너에게 주고, 받은 토큰을 저장한다', async () => {
    const begun = await start('claude');
    assert.equal((await start('claude')).taskId, begun.taskId, '도구마다 하나');
    assert.equal((await signinOf('claude'))?.step, 'starting');

    const task = await takeSignin('claude');
    const early = await pasteCode(task.id, 'code#state');
    assert.equal(early.status, 422, '주소를 보이기 전에는 코드를 받지 않는다');

    const shown = await relay(task.id, { url: CLAUDE_URL });
    assert.equal(shown.ok, true, JSON.stringify(shown.body));
    assert.equal(shown.body.code, null);
    assert.deepEqual(await signinOf('claude'), {
      taskId: task.id,
      step: 'waiting_code',
      url: CLAUDE_URL,
      userCode: null,
    });

    assert.equal((await pasteCode(task.id, 'with space')).status, 422);
    ok(await pasteCode(task.id, 'code#state'));
    assert.equal((await signinOf('claude'))?.step, 'verifying');
    const raw = await db.sql`SELECT payload FROM task.tasks WHERE id = ${String(task.id)}`;
    assert.equal(
      JSON.stringify(raw[0]?.payload).includes('code#state'),
      false,
      '코드는 암호화해 둔다',
    );

    const detail = await getTask(task.id);
    assert.equal(
      'code' in (detail.payload as Json),
      false,
      '작업 상세에는 암호문도 내보내지 않는다',
    );

    assert.equal((await relay(task.id)).body.code, 'code#state');
    assert.equal(
      (await relay(task.id)).body.code,
      'code#state',
      '응답을 잃어도 다시 받는다 (끝날 때까지)',
    );

    const token = newToken().replace(/-/g, '_');
    const saved = await relay(task.id, { credential: `sk-ant-oat01-${token}` });
    assert.equal(saved.body.status, 'done');
    const again = await relay(task.id, { credential: `sk-ant-oat01-${token}` });
    assert.equal(again.ok, true, '응답을 잃고 다시 보내도 같은 답');
    assert.equal(again.body.status, 'done');
    assert.equal(again.body.code, null);
    const claudeNow = await claude();
    assert.equal(claudeNow.connected, true);
    assert.equal(claudeNow.signin, null);
    assert.equal(
      (await tool(runner, 'ai_login', { tool: 'claude' })).body.token,
      `sk-ant-oat01-${token}`,
    );
    const events = (await getTask(task.id)).events as Json[];
    assert.equal(
      JSON.stringify(events).includes('claude.ai/oauth'),
      false,
      '주소·코드·토큰은 기록에 없다',
    );
  });

  test('Codex: 주소와 코드를 보이고, 받은 auth.json을 만료 없이 저장한다', async () => {
    const begun = await start('codex');
    const task = await takeSignin('codex');
    assert.equal(task.id, begun.taskId);

    const noCode = await relay(task.id, { url: CODEX_URL });
    assert.equal(noCode.ok, false);
    assert.equal(noCode.body.code, 'rule_violation', 'Codex는 화면의 코드가 꼭 있다');
    const shown = await relay(task.id, { url: CODEX_URL, user_code: 'ABCD-12345' });
    assert.equal(shown.ok, true, JSON.stringify(shown.body));
    assert.deepEqual(await signinOf('codex'), {
      taskId: task.id,
      step: 'open_url',
      url: CODEX_URL,
      userCode: 'ABCD-12345',
    });
    const paste = await pasteCode(task.id, 'code#state');
    assert.equal(paste.status, 422, 'Codex는 붙여 넣는 코드가 없다');

    const saved = await relay(task.id, { credential: AUTH_JSON });
    assert.equal(saved.body.status, 'done');
    const { tools } = ok(await api.get('/api/ai', owner)) as { tools: Json[] };
    const codex = tools.find((t) => t.tool === 'codex');
    assert.equal(codex?.connected, true);
    assert.equal(codex?.expiresAt, null, '갱신 토큰이 든 auth.json은 만료를 알 수 없다');
    assert.equal(codex?.signin, null);
    assert.equal((await claude()).connected, false, 'Claude 로그인과는 따로다');
    const handed = await tool(runner, 'ai_login', { tool: 'codex' });
    assert.equal(handed.body.token, AUTH_JSON);
    assert.equal(handed.body.expiresAt ?? null, null);
  });

  test('임대를 쥔 러너만 알린다. 이상한 주소와 자격은 받지 않는다', async () => {
    await start('claude');
    const task = await takeSignin('claude');
    const other = ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: `다른-러너-${randomUUID().slice(0, 8)}`,
      }),
      201,
    ) as { token: string };
    const stolen = await relay(task.id, { url: CLAUDE_URL }, other.token);
    assert.equal(stolen.ok, false, '다른 러너는 남의 로그인에 끼어들지 못한다');
    assert.equal((await signinOf('claude'))?.step, 'starting');

    for (const url of [
      'https://evil.example/oauth/authorize',
      'https://claude.ai:8443/oauth/authorize',
      'https://user@claude.ai/oauth/authorize',
      'not a url',
    ]) {
      const bad = await relay(task.id, { url });
      assert.equal(bad.body.code, 'rule_violation', url);
    }
    const withCode = await relay(task.id, { url: CLAUDE_URL, user_code: 'ABCD-12345' });
    assert.equal(withCode.body.code, 'rule_violation', 'Claude 화면에는 코드가 없다');

    assert.equal((await relay(task.id, { url: CLAUDE_URL })).ok, true);
    assert.equal(
      (await relay(task.id, { url: CLAUDE_URL })).ok,
      true,
      '같은 주소를 다시 보내도 된다',
    );
    const moved = await relay(task.id, {
      url: 'https://claude.com/cai/oauth/authorize?code=true&state=other',
    });
    assert.equal(moved.body.code, 'conflict', '주소는 한 번 정하면 바뀌지 않는다');
    assert.equal((await signinOf('claude'))?.url, CLAUDE_URL);

    for (const credential of [
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
      'sk-ant-oat01-short',
      '{}',
    ]) {
      const bad = await relay(task.id, { credential });
      assert.equal(bad.body.code, 'rule_violation', credential.slice(0, 12));
    }
    assert.equal((await claude()).connected, false, '틀린 자격은 저장하지 않는다');
    assert.equal((await getTask(task.id)).status, 'running');
  });

  test('주인이 취소하면 러너는 cancelled를 받고, 더는 저장하지 못한다', async () => {
    await start('claude');
    const task = await takeSignin('claude');
    assert.equal((await relay(task.id, { url: CLAUDE_URL })).ok, true);
    const finished = await submit(task.id, 'done');
    assert.equal(finished.body.code, 'rule_violation', '자격 없이 done으로 끝낼 수 없다');
    ok(await pasteCode(task.id, 'code#state'));
    const { version } = await getTask(task.id);
    ok(await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, { version }));
    assert.equal(await signinOf('claude'), null, '취소한 로그인은 보이지 않는다');
    const [row] = await db.sql`SELECT payload FROM task.tasks WHERE id = ${String(task.id)}`;
    assert.deepEqual(row?.payload, { tool: 'claude' }, '가져가지 않은 코드도 주소도 지운다');

    const told = await relay(task.id, { credential: newToken() });
    assert.equal(told.ok, true, JSON.stringify(told.body));
    assert.equal(told.body.cancelled, true);
    assert.equal((await claude()).connected, false, '취소 뒤 온 자격은 버린다');
    assert.notEqual((await start('claude')).taskId, task.id, '다시 시작하면 새 작업');
  });

  /** 러너가 가진 것을 알리고 일을 빌린다 */
  const leaseAs = async (ability: Json, limit = 5): Promise<Json[]> => {
    const res = await tool(runner, 'next_jobs', { limit, ...ability });
    assert.equal(res.ok, true, JSON.stringify(res.body));
    return res.body.jobs as Json[];
  };
  const idsOf = (jobs: Json[]) => jobs.map((j) => (j.task as Json).id);
  const NOTHING = { tools: [], signin_tools: [], own_logins: [] };

  /** 웹 로그인으로 Codex 로그인을 만든다 */
  async function codexLogin(credential = AUTH_JSON): Promise<void> {
    await start('codex');
    const task = await takeSignin('codex');
    assert.equal((await relay(task.id, { url: CODEX_URL, user_code: 'ABCD-12345' })).ok, true);
    assert.equal((await relay(task.id, { credential })).body.status, 'done');
  }

  async function codexAgent(): Promise<Json> {
    return ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: 'Codex 글쓰기',
        tool: 'codex',
        scopes: ['read_public', 'write'],
      }),
      201,
    );
  }

  test('러너가 알린 도구 중 쓸 수 있는 로그인이 있는 도구의 일만 준다', async () => {
    const work = await newTask(await newAgent());
    assert.deepEqual(
      await leaseAs({ ...NOTHING, tools: ['claude'] }),
      [],
      'Claude 로그인이 없으면 빌려 주지 않는다 (빌렸다 돌려주지 않게)',
    );
    assert.deepEqual(await leaseAs({ ...NOTHING, tools: ['codex'] }), [], '다른 도구만 가진 러너');
    await saveToken(newToken());
    assert.deepEqual(idsOf(await leaseAs({ ...NOTHING, tools: ['claude'] })), [work.id]);
  });

  test('러너가 스스로 로그인을 가졌으면 서버의 로그인이 없어도 준다', async () => {
    const work = await newTask(await newAgent());
    const jobs = await leaseAs({ ...NOTHING, tools: ['claude'], own_logins: ['claude'] });
    assert.deepEqual(idsOf(jobs), [work.id]);
  });

  test('연결 확인은 그 도구를 가졌고 서버의 로그인을 쓸 수 있을 때만', async () => {
    await saveToken(newToken());
    const { taskId } = await startTest();
    assert.deepEqual(await leaseAs(NOTHING), []);
    await db.sql`UPDATE task.ai_logins SET expires_at = now() - interval '1 second'`;
    assert.deepEqual(
      await leaseAs({ ...NOTHING, tools: ['claude'] }),
      [],
      '만료된 로그인은 확인도 미룬다',
    );
    await db.sql`UPDATE task.ai_logins SET expires_at = now() + interval '1 day'`;
    assert.deepEqual(idsOf(await leaseAs({ ...NOTHING, tools: ['claude'] })), [taskId]);
  });

  test('웹 로그인은 signin_tools의 도구만 준다', async () => {
    const claudeSignin = await start('claude');
    const codexSignin = await start('codex');
    assert.deepEqual(await leaseAs(NOTHING), []);
    assert.deepEqual(idsOf(await leaseAs({ ...NOTHING, signin_tools: ['codex'] })), [
      codexSignin.taskId,
    ]);
    assert.equal((await signinOf('claude'))?.step, 'starting', 'Claude 로그인은 대기열에');
    assert.deepEqual(idsOf(await leaseAs({ ...NOTHING, signin_tools: ['claude'] })), [
      claudeSignin.taskId,
    ]);
  });

  test('갱신 토큰이 바뀌는 Codex는 서버 로그인으로 한 번에 하나만 돈다', async () => {
    await codexLogin();
    const agent = await codexAgent();
    const first = await newTask(agent);
    const second = await newTask(agent);
    const ability = { ...NOTHING, tools: ['codex'] };
    assert.deepEqual(idsOf(await leaseAs(ability)), [first.id], '하나만');
    assert.deepEqual(await leaseAs(ability), [], '앞의 것이 도는 동안은 주지 않는다');
    assert.equal((await submit(first.id, 'done')).ok, true);
    assert.deepEqual(idsOf(await leaseAs(ability)), [second.id]);
  });

  test('ai_login_refresh: 쥔 일과 받은 판으로만 Codex 자격을 되돌려 쓴다', async () => {
    await codexLogin();
    const task = await newTask(await codexAgent());
    assert.deepEqual(idsOf(await leaseAs({ ...NOTHING, tools: ['codex'] })), [task.id]);
    const handed = await tool(runner, 'ai_login', { tool: 'codex' });
    const version = handed.body.version as number;
    assert.equal(typeof version, 'number');

    const rotated = JSON.stringify({ tokens: { refresh_token: 'r2', access_token: 'a2' } });
    const refresh = (args: Json) =>
      tool(runner, 'ai_login_refresh', {
        task_id: task.id,
        tool: 'codex',
        version,
        credential: rotated,
        ...args,
      });
    assert.equal((await refresh({ credential: 'not json' })).body.code, 'rule_violation');
    assert.equal(
      (await refresh({ tool: 'claude' })).body.code,
      'rule_violation',
      'Claude 토큰은 바뀌지 않는다',
    );
    assert.equal((await refresh({ task_id: randomUUID() })).ok, false, '쥔 일이 아니면');

    const saved = await refresh({});
    assert.equal(saved.ok, true, JSON.stringify(saved.body));
    assert.equal(saved.body.version, version + 1);
    const after = await tool(runner, 'ai_login', { tool: 'codex' });
    assert.equal(after.body.token, rotated);
    assert.equal(after.body.version, version + 1);
    assert.equal(after.body.expires_at ?? null, null, '만료는 그대로 없다');

    const stale = await refresh({ credential: AUTH_JSON });
    assert.equal(stale.body.code, 'conflict', '옛 판으로는 덮지 못한다');
    assert.equal((await tool(runner, 'ai_login', { tool: 'codex' })).body.token, rotated);

    // 주인이 취소해도 맡았던 러너의 되돌려 쓰기는 받는다: 버리면 다음 실행에서 로그인이 깨진다
    const { version: taskVersion } = await getTask(task.id);
    ok(await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, { version: taskVersion }));
    const afterCancel = await refresh({ version: version + 1, credential: AUTH_JSON });
    assert.equal(afterCancel.ok, true, JSON.stringify(afterCancel.body));
    const other = ok(
      await api.request('POST', '/api/devices/runner', owner, {
        requestId: randomUUID(),
        name: `남의-러너-${randomUUID().slice(0, 8)}`,
      }),
      201,
    ) as { token: string };
    const foreign = await tool(other.token, 'ai_login_refresh', {
      task_id: task.id,
      tool: 'codex',
      version: version + 2,
      credential: rotated,
    });
    assert.equal(foreign.ok, false, '맡지 않았던 러너는 되돌려 쓰지 못한다');
  });

  test('동시에 두 번 시작해도 로그인 작업은 하나다', async () => {
    const [a, b] = await Promise.all([start('codex'), start('codex')]);
    assert.equal(a.taskId, b.taskId);
    const [row] = await db.sql`
      SELECT count(*)::int AS n FROM task.tasks
      WHERE kind = 'ai_signin' AND payload->>'tool' = 'codex' AND status IN ('queued', 'running')`;
    assert.equal(row?.n, 1);
  });

  test('러너가 돌려준 로그인은 주소를 비우고 처음부터 다시 돈다', async () => {
    await start('claude');
    const task = await takeSignin('claude');
    assert.equal((await relay(task.id, { url: CLAUDE_URL })).ok, true);
    ok(await pasteCode(task.id, 'code#state'));
    const released = await tool(runner, 'release_job', { task_id: task.id, reason: '멈춰요' });
    assert.equal(released.ok, true, JSON.stringify(released.body));
    const [row] = await db.sql`SELECT payload FROM task.tasks WHERE id = ${String(task.id)}`;
    assert.deepEqual(row?.payload, { tool: 'claude' }, '주소도 코드도 남지 않는다');
    assert.deepEqual(await signinOf('claude'), {
      taskId: task.id,
      step: 'starting',
      url: null,
      userCode: null,
    });
  });

  test('로그인하는 동안 러너가 닿은 때를 남긴다', async () => {
    await start('claude');
    const task = await takeSignin('claude');
    await db.sql`UPDATE task.runners SET last_seen_at = now() - interval '10 minutes'`;
    assert.equal((await relay(task.id)).ok, true);
    const [row] = await db.sql`
      SELECT count(*)::int AS n FROM task.runners WHERE last_seen_at > now() - interval '1 minute'`;
    assert.ok(Number(row?.n) >= 1);
  });

  test('이 용도로 싼 코드가 아니면 러너에게 주지 않는다', async () => {
    await start('claude');
    const task = await takeSignin('claude');
    assert.equal((await relay(task.id, { url: CLAUDE_URL })).ok, true);
    // 다른 용도로 싼 값(예: 작업 토큰 모양)이 코드 자리에 있어도 풀어 주지 않는다
    const foreign = SecretBox.fromEnv(process.env).pack('agent:{"spaceId":"x"}', 600);
    await db.sql`
      UPDATE task.tasks SET payload = payload || ${db.sql.json({ code: foreign, step: 'verifying' })}
      WHERE id = ${String(task.id)}`;
    assert.equal((await relay(task.id)).body.code, null);
  });

  test('Codex auth.json이 JSON 객체가 아니면 받지 않는다', async () => {
    await start('codex');
    const task = await takeSignin('codex');
    for (const credential of ['not json', '[1,2]', '"text"', `{"a":"${'x'.repeat(70_000)}"}`]) {
      const bad = await relay(task.id, { credential });
      assert.equal(bad.ok, false, credential.slice(0, 12));
    }
    const { tools } = ok(await api.get('/api/ai', owner)) as { tools: Json[] };
    assert.equal(tools.find((t) => t.tool === 'codex')?.connected, false);
  });
});
