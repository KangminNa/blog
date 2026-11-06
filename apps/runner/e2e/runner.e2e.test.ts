import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Database, OutboxWorker } from '../../server/src/modules/platform';
import { ApiClient, type ApiResult, type TestUser } from '../../server/src/testing/api-client';

// 러너 전체: 실제 서버, 실제 러너 프로세스, 표준 입출력만 흉내 낸 가짜 AI CLI (fake-claude.mjs).
// 진짜 claude는 쓰지 않는다. 주인은 REST로, 러너는 MCP로만 들어온다.
//
// 러너 하나를 띄워 두고 계속 쓴다. 테스트마다 러너를 끄고 켜면 안 된다: 끊긴 next_jobs도 서버는 시간이 다 될 때까지 찾아서
// 다음 테스트의 일을 사라진 러너에게 빌려 준다 (stop의 설명). 멈추는 동작은 맨 뒤에서 따로 본다.

type Json = Record<string, unknown>;

const FAKE_CLI = resolve(__dirname, 'fake-claude.mjs');
const RUNNER_MAIN = resolve(__dirname, '../src/main.ts');
const OAUTH_TOKEN = `claude-${randomUUID()}`;
/** 가짜 CLI의 assistant 줄이 낸 420에 result의 합계가 7을 더한다 */
const FAKE_TOKENS = 427;

let api: ApiClient;
let owner: TestUser;
let db: Database;
/** run 권한을 준 기기의 토큰 */
let deviceToken: string;
let spyDir: string;
/** 이 프로세스의 러너들. 테스트가 실패해도 끝에서 끈다 */
const started = new Set<RunnerProcess>();

/** 실행 중인 러너 프로세스 하나. 로그를 모은다 */
class RunnerProcess {
  private output = '';
  private readonly ended: Promise<number | null>;

  constructor(private readonly child: ChildProcess) {
    const collect = (chunk: Buffer) => {
      this.output += chunk.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    this.ended = new Promise((done) => child.once('exit', (code) => done(code)));
    started.add(this);
  }

  /** 서버의 cwd 기준으로 swc를 찾으므로 apps/server에서 띄운다 */
  static start(url: string, env: Json = {}): RunnerProcess {
    return new RunnerProcess(
      spawn(process.execPath, ['-r', '@swc-node/register', RUNNER_MAIN], {
        env: {
          PATH: process.env.PATH,
          // swc가 쓰는 캐시 자리. AI CLI는 빈 홈을 받아야 한다
          HOME: process.env.HOME,
          // AI CLI에게 가면 안 되는 값
          DATABASE_URL: process.env.DATABASE_URL,
          CAIRN_RUNNER_URL: url,
          CAIRN_RUNNER_TOKEN: deviceToken,
          CAIRN_RUNNER_CLI: FAKE_CLI,
          CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN,
          ...env,
        } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  }

  get logs(): string {
    return this.output;
  }

  logged(text: string): Promise<boolean> {
    return until(`로그: ${text}`, () => (this.output.includes(text) ? true : null));
  }

  exited(): Promise<number | null> {
    return this.ended;
  }

  signal(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<number | null> {
    this.signal(signal);
    return this.ended;
  }
}

/** 러너와 서버 사이의 앞단. 평소에는 그대로 넘기고, 알려 준 도구의 응답을 한 번씩 잃어버린다 */
class LossyProxy {
  readonly lost = new Set<string>();
  private armed: readonly string[] = [];
  private server: Server | null = null;

  constructor(private readonly target: string) {}

  async start(): Promise<string> {
    const server = createServer((req, res) => void this.forward(req, res));
    this.server = server;
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  /** 요청은 서버까지 보내고 응답만 끊는다. 러너는 보내지 못한 줄 안다 */
  loseNext(tools: readonly string[]): void {
    this.armed = tools;
  }

  close(): void {
    this.server?.close();
    this.server?.closeAllConnections();
  }

  private async forward(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const answer = await fetch(`${this.target}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body,
    });
    const text = await answer.text();
    if (this.losing(body)) {
      req.socket.destroy();
      return;
    }
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(text);
  }

  /** 빈 보고는 토큰이 없어 볼 것이 없다. 기록이 든 보고만 잃는다 */
  private losing(body: string): boolean {
    const { method, params } = JSON.parse(body) as {
      method: string;
      params: { name: string; arguments: Json };
    };
    if (method !== 'tools/call' || !this.armed.includes(params.name)) return false;
    if (params.name === 'report_progress' && !params.arguments.request_id) return false;
    this.armed = this.armed.filter((tool) => tool !== params.name);
    this.lost.add(params.name);
    return true;
  }
}

function ok(res: ApiResult, status = 200): Json {
  assert.equal(res.status, status, res.text);
  return res.json();
}

const newAgent = async (more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/agents', owner, {
      requestId: randomUUID(),
      name: '글쓰기',
      role: '블로그 글을 쓴다',
      tool: 'claude',
      scopes: ['read_public', 'write'],
      approvalActions: ['blog.post.publish'],
      ...more,
    }),
    201,
  );

/** 지시문의 표시로 가짜 CLI가 할 일을 정한다 */
const newTask = async (agent: Json, marks: string, more: Json = {}): Promise<Json> =>
  ok(
    await api.request('POST', '/api/tasks', owner, {
      requestId: randomUUID(),
      agentId: agent.id,
      instruction: `글을 써 주세요 ${marks}`,
      ...more,
    }),
    201,
  );

const getTask = async (id: unknown): Promise<Json> => ok(await api.get(`/api/tasks/${id}`, owner));

const cancelTask = async (task: Json): Promise<void> => {
  const { version } = await getTask(task.id);
  ok(await api.request('POST', `/api/tasks/${task.id}/cancel`, owner, { version }));
};

async function until<T>(what: string, read: () => Promise<T | null> | T | null): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    const logs = [...started].map((r) => r.logs.slice(-1500)).join('\n---\n');
    assert.ok(Date.now() < deadline, `기다렸지만 오지 않음: ${what}\n${logs}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

const taskIn = (id: unknown, status: string): Promise<Json> =>
  until(`작업이 ${status}`, async () => {
    const task = await getTask(id);
    return task.status === status ? task : null;
  });

/** 가짜 CLI가 적은 것 */
class Spy {
  readonly path = join(spyDir, `${randomUUID()}.json`);

  get mark(): string {
    return `[fake:spy=${this.path}]`;
  }

  async seen(): Promise<Json> {
    return until('가짜 CLI가 뜸', () => {
      if (!existsSync(this.path)) return null;
      try {
        return JSON.parse(readFileSync(this.path, 'utf8')) as Json;
      } catch {
        return null; // 쓰는 중
      }
    });
  }
}

const alive = (pid: unknown): boolean => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const gone = (pid: unknown): Promise<boolean> =>
  until('AI CLI가 꺼짐', () => (alive(pid) ? null : true));

const events = (task: Json): Json[] => task.events as Json[];
const kinds = (task: Json): unknown[] => events(task).map((e) => e.kind);
const tokens = (task: Json): number => events(task).reduce((sum, e) => sum + Number(e.tokens), 0);

before(async () => {
  chmodSync(FAKE_CLI, 0o755);
  spyDir = mkdtempSync(join(tmpdir(), 'cairn-e2e-'));
  api = await ApiClient.start();
  owner = await api.signIn();
  db = api.service(Database);
  const { version } = (await api.get('/api/space')).json() as { version: number };
  await api.request('PUT', '/api/space', owner, { name: '러너', siteUrl: api.baseUrl, version });
  await api.connectDevice(owner, 'e2e-runner');
  const { devices } = ok(await api.get('/api/devices', owner)) as {
    devices: { id: string; name: string; scopes: string[]; version: number }[];
  };
  const device = devices.find((d) => d.name === 'e2e-runner');
  ok(
    await api.request('PATCH', `/api/devices/${device?.id}`, owner, {
      scopes: [...(device?.scopes ?? []), 'run'],
      version: device?.version,
    }),
  );
  const spare = ok(await api.request('POST', `/api/devices/${device?.id}/token`, owner));
  deviceToken = String(spare.token);
});

beforeEach(async () => {
  await db.sql`
    UPDATE task.tasks SET status = 'cancelled', lease_until = NULL, wait_reason = NULL
    WHERE status IN ('queued', 'running', 'waiting')`;
});

after(async () => {
  for (const runner of started) runner.signal('SIGKILL');
  await api.close();
  rmSync(spyDir, { recursive: true, force: true });
});

describe('러너가 일을 처리한다', () => {
  let proxy: LossyProxy;
  let proxyUrl: string;
  let runner: RunnerProcess;

  before(async () => {
    proxy = new LossyProxy(api.baseUrl);
    proxyUrl = await proxy.start();
    runner = RunnerProcess.start(proxyUrl);
    await runner.logged('러너를 시작했어요');
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
    proxy.close();
  });

  test('작업을 만들면 러너가 맡아 기록을 남기고 done으로 끝낸다', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '');

    const task = await taskIn(created.id, 'done');

    assert.deepEqual(task.result, { text: '초안을 저장했어요' });
    assert.deepEqual(kinds(task), ['read', 'write', 'error', 'result', 'result']);
    assert.equal(events(task)[0]?.body, 'Read notes.md');
    assert.equal(events(task)[1]?.body, 'blog_save_draft');
    assert.equal(tokens(task), FAKE_TOKENS);
    assert.equal(JSON.stringify(task).includes('본문은 기록에 남기지 않는다'), false);
  });

  test('금방 끝난 실행의 구독 사용률도 서버에 닿고, 닿은 에이전트의 일은 쉬었다가 다시 돈다', async () => {
    await newTask(await newAgent(), '').then((created) => taskIn(created.id, 'done'));
    const usage = ok(await api.get('/api/usage', owner)) as { agents: Json[]; plan: Json[] };
    const percent = (window: string) =>
      usage.plan.find((p) => p.tool === 'claude' && p.window === window)?.percent;
    assert.equal(percent('five_hour'), 72);
    assert.equal(percent('seven_day'), 19);

    const held = await newAgent({ planStopPercent: 50 });
    const waiting = await newTask(held, '');
    // 뒤에 넣은 일이 끝나도 앞의 일은 대기열에 남는다
    const other = await newTask(await newAgent(), '');
    await taskIn(other.id, 'done');
    assert.equal((await getTask(waiting.id)).status, 'queued');
    assert.equal((await getTask(waiting.id)).attempts, 0);
    const after = ok(await api.get('/api/usage', owner)) as { agents: Json[] };
    assert.equal(after.agents.find((a) => a.id === held.id)?.holding, true);

    ok(
      await api.request('PATCH', `/api/agents/${held.id}`, owner, {
        version: held.version,
        planStopPercent: 90,
      }),
    );
    await taskIn(waiting.id, 'done');
  });

  test('지시와 역할이 AI CLI에게 가고, 사용자의 것은 아무것도 가지 않는다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark);
    const seen = await spy.seen();
    await taskIn(created.id, 'done');
    await runner.logged(`${created.id}: 끝났어요`);

    const env = seen.env as Record<string, string>;
    assert.ok(String(seen.prompt).includes('블로그 글을 쓴다'));
    assert.ok(String(seen.prompt).includes('글을 써 주세요'));
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, OAUTH_TOKEN);
    assert.equal(env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
    assert.equal(Object.values(env).includes(deviceToken), false);
    assert.equal(env.CAIRN_RUNNER_TOKEN, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.notEqual(env.HOME, process.env.HOME);
    assert.deepEqual(seen.cwdEntries, []);
    assert.deepEqual(seen.configEntries, ['settings.json']);
    assert.equal(seen.mcpConfigMode, 0o600);
    assert.equal(seen.mcpUrl, `${proxyUrl}/mcp`);
    assert.notEqual(seen.runToken, deviceToken);

    const args = seen.argv as string[];
    for (const flag of ['-p', '--verbose', '--strict-mcp-config']) assert.ok(args.includes(flag));
    assert.equal(args.includes('--bare'), false);
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit');

    await until('자리가 지워짐', () =>
      [seen.cwd, env.CLAUDE_CONFIG_DIR, env.HOME, seen.mcpConfigPath].some((p) =>
        existsSync(String(p)),
      )
        ? null
        : true,
    );
  });

  test('로그와 기록에 토큰이 남지 않는다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark);
    const seen = await spy.seen();
    const task = await taskIn(created.id, 'done');
    await runner.logged(`${created.id}: 끝났어요`);

    const record = `${JSON.stringify(task)}\n${runner.logs}`;
    for (const token of [OAUTH_TOKEN, deviceToken, String(seen.runToken)])
      assert.equal(record.includes(token), false);
    assert.ok(JSON.stringify(task).includes('[지움: 토큰]'));
  });

  test('정리 작업은 cairn-tidy를 설정 폴더에 넣고 그 권한의 에이전트가 맡는다', async () => {
    const agent = await newAgent({ scopes: ['read_all', 'tidy'] });
    const spy = new Spy();
    const created = await newTask(agent, spy.mark, { kind: 'tidy_session', title: '정리' });
    const seen = await spy.seen();
    await taskIn(created.id, 'done');
    assert.ok(String(seen.prompt).includes('cairn-tidy 스킬을 따릅니다'));
    assert.ok((seen.configEntries as string[]).includes('skills'));
  });

  test('스킬이 있으면 설정 폴더에 넣고 따르라고 알린다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark, { kind: 'draft_post', title: '초안' });
    const seen = await spy.seen();
    await taskIn(created.id, 'done');
    assert.ok(String(seen.prompt).includes('cairn-write 스킬을 따릅니다'));
    assert.ok((seen.configEntries as string[]).includes('skills'));
    const args = seen.argv as string[];
    assert.equal(args[args.indexOf('--tools') + 1], 'Read,Write,Edit,Skill');
  });

  test('0이 아닌 코드로 끝나면 failed와 짧은 이유', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '[fake:fail]');
    const task = await taskIn(created.id, 'failed');
    const error = String((task.result as Json).error);
    assert.ok(error.includes('코드 3'), error);
    assert.ok(error.includes('모델에 닿지 못했어요'), error);
  });

  test('코드가 0이어도 결과가 실패면 failed', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '[fake:error-result]');
    const task = await taskIn(created.id, 'failed');
    assert.ok(String((task.result as Json).error).includes('턴 수를 넘겼어요'));
  });

  test('허락하지 않은 MCP 서버가 보이면 끄고 failed', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:stray]`);
    const seen = await spy.seen();
    const task = await taskIn(created.id, 'failed');
    assert.ok(String((task.result as Json).error).includes('claude.ai Gmail'));
    await gone(seen.pid);
  });

  test('응답을 잃으면 같은 request_id로 다시 보내 토큰과 결과가 한 번만 남는다', async () => {
    const agent = await newAgent();
    proxy.loseNext(['report_progress', 'submit_result']);
    const created = await newTask(agent, '');
    await taskIn(created.id, 'done');

    // 러너는 일 하나가 끝나야 다음을 받는다. 다음 일이 끝나면 앞의 제출을 다시 보내고 답까지 받은 것이다
    const next = await newTask(agent, '');
    await taskIn(next.id, 'done');

    assert.deepEqual([...proxy.lost].sort(), ['report_progress', 'submit_result']);
    const task = await getTask(created.id);
    assert.equal(tokens(task), FAKE_TOKENS);
    assert.deepEqual(kinds(task), ['read', 'write', 'error', 'result', 'result']);
  });

  test('주인이 취소하면 AI CLI를 끄고 제출하지 않으며 다음 일을 받는다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:hang]`);
    const seen = await spy.seen();
    await taskIn(created.id, 'running');
    assert.equal(alive(seen.pid), true);

    await cancelTask(created);

    await gone(seen.pid);
    await runner.logged(`${created.id}: 주인이 취소했어요`);
    const task = await getTask(created.id);
    assert.equal(task.status, 'cancelled');
    assert.equal(task.result, null);
    await until('자리가 지워짐', () => (existsSync(String(seen.cwd)) ? null : true));

    const next = await newTask(agent, '');
    await taskIn(next.id, 'done');
  });

  test('SIGTERM을 듣지 않는 AI CLI는 SIGKILL로 끈다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:stubborn]`);
    const seen = await spy.seen();
    await until('진행 기록', async () =>
      kinds(await getTask(created.id)).length > 0 ? true : null,
    );
    await cancelTask(created);
    await gone(seen.pid);
    await runner.logged(`${created.id}: 주인이 취소했어요`);
  });

  test('결재를 올리면 AI CLI를 끄고 waiting으로 남긴다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:approval] [fake:hang]`);
    const seen = await spy.seen();

    await taskIn(created.id, 'waiting');
    await gone(seen.pid);
    await runner.logged(`${created.id}: 결재나 하위 작업을 기다려요`);
    const task = await getTask(created.id);
    assert.equal(task.status, 'waiting');
    assert.equal(task.result, null);
    const { approvals } = ok(await api.get('/api/approvals', owner)) as { approvals: Json[] };
    assert.equal(approvals.filter((a) => a.taskId === created.id).length, 1);
  });

  test('결재를 올리고 바로 끝난 실행도 done으로 보내지 않는다', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '[fake:approval]');
    await runner.logged(`${created.id}: 결재나 하위 작업을 기다려요`);
    const task = await getTask(created.id);
    assert.equal(task.status, 'waiting');
    assert.equal(kinds(task).filter((k) => k === 'result').length, 1);
    assert.equal(task.result, null);
  });

  test('팀장이 팀에게 맡기면 팀원의 일이 돌고, 모두 끝나면 결과를 받아 팀장이 끝낸다', async () => {
    const lead = await newAgent({ name: '팀장' });
    const members = [
      await newAgent({ name: '조사 1', reportsTo: lead.id }),
      await newAgent({ name: '조사 2', reportsTo: lead.id }),
    ];
    const spy = new Spy();
    const created = await newTask(lead, `[fake:delegate] ${spy.mark}`);

    await runner.logged(`${created.id}: 결재나 하위 작업을 기다려요`);
    // 팀장을 깨우는 일은 일꾼(outbox)이 한다. 이 테스트에는 일꾼 프로세스가 없어 직접 돌린다
    const worker = api.service(OutboxWorker);
    const done = await until('팀장이 깨어나 끝남', async () => {
      await worker.tick();
      const task = await getTask(created.id);
      return task.status === 'done' ? task : null;
    });
    const children = done.children as Json[];
    assert.deepEqual(
      children.map((c) => [c.agentId, c.status]).sort(),
      members.map((m) => [m.id, 'done']).sort(),
    );
    // 마지막 실행(깨어난 팀장)의 지시문에 팀원의 결과가 있다
    const { prompt } = await spy.seen();
    assert.ok(String(prompt).includes('# 맡긴 하위 작업의 결과'));
    assert.ok(String(prompt).includes('## [완료] 조사 1에게 맡긴 조사 (조사 1)'));
    assert.ok(String(prompt).includes('남은 위임 횟수: 2'));
  });

  test('에이전트가 멈추면 AI CLI를 끄고 일을 돌려준다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, `${spy.mark} [fake:hang]`);
    const seen = await spy.seen();
    await taskIn(created.id, 'running');

    ok(
      await api.request('POST', `/api/agents/${agent.id}/pause`, owner, {
        version: agent.version,
      }),
    );

    const task = await taskIn(created.id, 'queued');
    await gone(seen.pid);
    const bodies = events(task).map((e) => e.body);
    assert.ok(bodies.includes('돌려줌: 에이전트가 멈췄어요'), JSON.stringify(bodies));
  });
});

// 서버 러너의 길: 환경 변수에 토큰이 없고, 콘솔에 넣은 토큰을 일마다 ai_login으로 받는다.
describe('콘솔에 넣은 토큰으로 일한다', () => {
  let runner: RunnerProcess;

  const claude = async (): Promise<Json> =>
    (ok(await api.get('/api/ai', owner)) as { tools: Json[] }).tools[0] as Json;
  const saveToken = async (token: string): Promise<void> => {
    ok(await api.request('PUT', '/api/ai/claude/token', owner, { token }));
  };
  const startTest = async (): Promise<Json> =>
    ok(await api.request('POST', '/api/ai/claude/test', owner));

  before(async () => {
    runner = RunnerProcess.start(api.baseUrl, { CLAUDE_CODE_OAUTH_TOKEN: '' });
    await runner.logged('AI 토큰은 콘솔의 AI 메뉴에 넣은 값을 써요');
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
  });

  test('토큰이 없으면 일을 빌리지 않고 기다렸다가, 넣으면 그 토큰으로 일한다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark);

    await runner.logged('AI 토큰이 없어 일을 빌리지 않아요');
    await new Promise((done) => setTimeout(done, 4_000)); // 토큰을 몇 번 더 물어볼 시간
    const held = await getTask(created.id);
    assert.equal(held.status, 'queued', '실패로 끝내지 않는다');
    assert.equal(held.attempts, 0);
    assert.deepEqual(events(held), [], '오류 기록이 쌓이지 않는다');
    assert.equal(runner.logs.split('AI 토큰이 없어').length - 1, 1, '로그는 한 번만');
    assert.match(runner.logs, /AI 토큰이 없어 일을 빌리지 않아요: .*AI 메뉴/);

    const token = `sk-ant-oat01-${randomUUID()}`;
    await saveToken(token);

    const seen = await spy.seen();
    assert.equal((seen.env as Json).CLAUDE_CODE_OAUTH_TOKEN, token);
    const task = await taskIn(created.id, 'done');
    await runner.logged(`${created.id}: 끝났어요`);
    assert.ok(runner.logs.includes('AI 토큰을 받아 일을 빌려요'));
    assert.equal(
      events(task).some((e) => String(e.body).startsWith('돌려줌')),
      false,
    );
    const record = `${JSON.stringify(task)}\n${runner.logs}`;
    assert.equal(record.includes(token), false);
    assert.ok(JSON.stringify(task).includes('[지움: 토큰]'), '가짜 CLI가 뱉은 토큰을 지웠다');
  });

  test('연결 확인은 일을 받을 에이전트가 없어도 MCP 없이 돌고 결과를 남긴다', async () => {
    await db.sql`UPDATE task.agents SET status = 'paused'`;
    await saveToken(`sk-ant-oat01-${randomUUID()}`);
    assert.equal((await claude()).checkedAt, null);

    const { taskId } = await startTest();
    const task = await taskIn(taskId, 'done');

    assert.deepEqual(task.result, { text: 'ok' }, 'MCP 설정이 있었다면 가짜 CLI가 다르게 답한다');
    assert.equal(task.agentId, null);
    const state = await claude();
    assert.ok(state.checkedAt);
    assert.equal(state.lastError, null);
  });

  test('틀린 토큰이면 이유를 남기고, 토큰은 어디에도 남지 않는다', async () => {
    const token = `sk-ant-oat01-wrong-${randomUUID()}`;
    await saveToken(token);

    const { taskId } = await startTest();
    const task = await taskIn(taskId, 'failed');

    const state = await claude();
    assert.ok(state.checkedAt);
    assert.match(String(state.lastError), /코드 1.*틀린 토큰/);
    const record = `${JSON.stringify(task)}\n${JSON.stringify(state)}\n${runner.logs}`;
    assert.equal(record.includes(token), false);
    assert.equal(record.includes('[지움: 토큰]'), true);
  });
});

// 콘솔에 토큰을 지우는 길이 없어 만료시킨다. 러너가 꺼진 사이 맡긴 확인이 대기열에 남는 경우다.
describe('기다리는 연결 확인의 토큰이 사라진다', () => {
  test('토큰이 없는 동안 대기열에 남고, 돌아오면 다른 일보다 먼저 돈다', async () => {
    const token = `sk-ant-oat01-${randomUUID()}`;
    ok(await api.request('PUT', '/api/ai/claude/token', owner, { token }));
    const test = ok(await api.request('POST', '/api/ai/claude/test', owner));
    await db.sql`UPDATE task.ai_logins SET expires_at = now() - interval '1 second'`;
    const other = await newTask(await newAgent(), '');

    const runner = RunnerProcess.start(api.baseUrl, { CLAUDE_CODE_OAUTH_TOKEN: '' });
    await runner.logged('AI 토큰이 없어 일을 빌리지 않아요: 만료된 토큰');
    await new Promise((done) => setTimeout(done, 1_500));
    const held = await getTask(test.taskId);
    assert.equal(held.status, 'queued');
    assert.deepEqual(events(held), []);
    assert.equal((await getTask(other.id)).status, 'queued');

    ok(await api.request('PUT', '/api/ai/claude/token', owner, { token }));

    await taskIn(test.taskId, 'done');
    await taskIn(other.id, 'done');
    await runner.logged(`${other.id}: 끝났어요`);
    const logs = runner.logs;
    assert.ok(
      logs.indexOf(`${test.taskId}: 일을 맡았어요`) < logs.indexOf(`${other.id}: 일을 맡았어요`),
    );
    runner.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await runner.exited(), 0);
  });
});

describe('러너를 멈춘다', () => {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    test(`${signal}이면 AI CLI를 끄고 일을 돌려준 뒤 0으로 끝난다`, async () => {
      const agent = await newAgent();
      const runner = RunnerProcess.start(api.baseUrl);
      const spy = new Spy();
      const created = await newTask(agent, `${spy.mark} [fake:hang]`);
      const seen = await spy.seen();
      await taskIn(created.id, 'running');

      assert.equal(await runner.stop(signal), 0);

      await gone(seen.pid);
      const task = await getTask(created.id);
      assert.equal(task.status, 'queued');
      assert.ok(events(task).some((e) => e.body === '돌려줌: 러너가 멈춰요'));
      assert.equal(existsSync(String(seen.cwd)), false);
    });
  }

  test('일을 기다리다 멈추면 그사이 온 일을 돌려준다', async () => {
    const agent = await newAgent();
    const runner = RunnerProcess.start(api.baseUrl);
    await runner.logged('러너를 시작했어요');
    await new Promise((done) => setTimeout(done, 300)); // next_jobs가 서버에 닿기를 기다린다
    runner.signal('SIGTERM');
    await runner.logged('기다리는 요청이 끝나면 멈춰요');

    const created = await newTask(agent, '');

    assert.equal(await runner.exited(), 0);
    const task = await getTask(created.id);
    assert.equal(task.status, 'queued');
    assert.ok(events(task).some((e) => e.body === '돌려줌: 러너가 멈춰요'));
  });

  test('AI CLI를 실행하지 못하면 일을 돌려주고 멈춘다', async () => {
    const agent = await newAgent();
    const created = await newTask(agent, '');
    const broken = RunnerProcess.start(api.baseUrl, { CAIRN_RUNNER_CLI: '/없는/claude' });
    assert.equal(await broken.exited(), 1);
    assert.ok(broken.logs.includes('AI CLI를 실행하지 못했어요'), broken.logs);
    const task = await getTask(created.id);
    assert.equal(task.status, 'queued');
    assert.equal(task.attempts, 0);
  });

  test('지원하지 않는 도구의 에이전트 일은 실패로 끝내고 계속 돈다', async () => {
    const agent = await newAgent({ tool: 'codex' });
    const created = await newTask(agent, '');
    const runner = RunnerProcess.start(api.baseUrl);
    const task = await taskIn(created.id, 'failed');
    assert.ok(String((task.result as Json).error).includes('codex'));

    const next = await newTask(await newAgent(), '');
    await taskIn(next.id, 'done');
    await runner.logged(`${next.id}: 끝났어요`);
    runner.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await runner.exited(), 0);
  });

  test('기기 토큰이 틀리면 바로 멈춘다', async () => {
    const denied = RunnerProcess.start(api.baseUrl, { CAIRN_RUNNER_TOKEN: 'cairn_wrong' });
    assert.equal(await denied.exited(), 1);
    assert.ok(denied.logs.includes('기기 토큰이 맞지 않아요'), denied.logs);
  });

  test('run 권한이 없는 기기는 바로 멈춘다', async () => {
    const laptop = await api.connectDevice(owner, 'e2e-laptop');
    const denied = RunnerProcess.start(api.baseUrl, { CAIRN_RUNNER_TOKEN: laptop });
    assert.equal(await denied.exited(), 1);
    assert.ok(denied.logs.includes("'run' 권한"), denied.logs);
  });

  test('설정이 빠지면 짧은 문구로 멈춘다', async () => {
    const blank = RunnerProcess.start(api.baseUrl, { CAIRN_RUNNER_TOKEN: '' });
    assert.equal(await blank.exited(), 1);
    assert.ok(blank.logs.includes('러너 설정이 빠졌어요: CAIRN_RUNNER_TOKEN'), blank.logs);
  });

  // 끊긴 긴 폴링이 서버에 남으므로 일을 쓰는 테스트는 이 앞에 둔다
  test('두 번째 신호는 기다리지 않고 바로 끝낸다', async () => {
    const runner = RunnerProcess.start(api.baseUrl);
    await runner.logged('러너를 시작했어요');
    await new Promise((done) => setTimeout(done, 300));
    runner.signal('SIGTERM');
    await runner.logged('기다리는 요청이 끝나면 멈춰요');
    const signalled = Date.now();
    assert.equal(await runner.stop(), 0);
    assert.ok(Date.now() - signalled < 3000);
  });
});
