import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ServerRunnerPolicy } from '../../server/src/modules/account/device/server-runner.policy';
import { Database, OutboxWorker } from '../../server/src/modules/platform';
import { ApiClient, type ApiResult, type TestUser } from '../../server/src/testing/api-client';
import { FakeGithubApi } from '../src/testing/fake-github-api';
import { GitServer } from '../src/testing/git-server';
import { TestChromium } from '../src/testing/test-chromium';

// 러너 전체: 실제 서버, 실제 러너 프로세스, 표준 입출력만 흉내 낸 가짜 AI CLI (fake-claude.mjs).
// 진짜 claude는 쓰지 않는다. 주인은 REST로, 러너는 MCP로만 들어온다.
//
// 러너 하나를 띄워 두고 계속 쓴다. 테스트마다 러너를 끄고 켜면 안 된다: 끊긴 next_jobs도 서버는 시간이 다 될 때까지 찾아서
// 다음 테스트의 일을 사라진 러너에게 빌려 준다 (stop의 설명). 멈추는 동작은 맨 뒤에서 따로 본다.

type Json = Record<string, unknown>;

const FAKE_CLI = resolve(__dirname, 'fake-claude.mjs');
const FAKE_CODEX = resolve(__dirname, 'fake-codex.mjs');
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
          CAIRN_RUNNER_CODEX_CLI: FAKE_CODEX,
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

  logged(text: string, waitMs?: number): Promise<boolean> {
    return until(`로그: ${text}`, () => (this.output.includes(text) ? true : null), waitMs);
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
    // 바이트 그대로 넘긴다 (결과물 파일은 글자가 아니다). 끊을지는 글자로 본다
    const raw = Buffer.concat(chunks);
    const body = raw.toString('utf8');
    const answer = await fetch(`${this.target}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(raw.length > 0 ? { body: raw } : {}),
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
    // MCP가 아닌 요청(결과물 파일 본문)은 끊지 않는다
    if (!body.startsWith('{')) return false;
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

async function until<T>(
  what: string,
  read: () => Promise<T | null> | T | null,
  waitMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + waitMs;
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
  chmodSync(FAKE_CODEX, 0o755);
  spyDir = mkdtempSync(join(tmpdir(), 'cairn-e2e-'));
  // 결과물: 시험 컴퓨터의 디스크가 작아도 받게 (기본은 20GB를 늘 남긴다)
  process.env.CAIRN_DISK_RESERVE_GB = '0';
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
    // 실행 기록: 어떤 규칙으로 돌았는지 (스킬 판 · CLI 버전 · 러너가 처음 알린 모델)
    const runs = task.runs as Json[];
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.seq, 1);
    assert.equal(runs[0]?.agentRevision, 1);
    assert.equal(runs[0]?.cliVersion, '2.1.302 (Claude Code)');
    assert.equal(runs[0]?.model, 'fake');
    assert.ok(String(runs[0]?.runnerBuild).length > 0);
    assert.equal(runs[0]?.skill, null, '일반 작업은 스킬이 없다');
  });

  test('outputs 폴더의 파일을 결과물로 올린다: 숨김 파일 · 폴더는 빼고 실행 기록에 남긴다', async () => {
    const created = await newTask(await newAgent(), '[fake:outputs]');
    const task = await taskIn(created.id, 'done');
    const outputs = task.outputs as Json[];
    assert.deepEqual(outputs.map((o) => o.name).sort(), ['chart.png', '보고서.md']);
    const chart = outputs.find((o) => o.name === 'chart.png');
    assert.deepEqual([chart?.kind, chart?.runSeq], ['image', 1]);
    const bodies = events(task).map((e) => String(e.body));
    assert.ok(bodies.includes('결과물 2개를 올렸어요'), bodies.join('\n'));
    assert.ok(bodies.some((b) => b.includes('.secret')));
    assert.ok(bodies.some((b) => b.includes('nested')));
    const report = outputs.find((o) => o.name === '보고서.md');
    const res = await fetch(`${api.baseUrl}/api/outputs/${report?.id}/file`, {
      headers: { cookie: owner.header },
    });
    assert.equal(await res.text(), '# 보고서\n결과물 시험\n');
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
    assert.deepEqual(seen.cwdEntries, ['outputs'], '빈 작업 폴더에 결과물 폴더만');
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
    await runner.logged('AI 로그인은 콘솔의 AI 메뉴에서 해요');
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
  });

  test('토큰이 없으면 서버가 일을 주지 않고 기다렸다가, 넣으면 그 토큰으로 일한다', async () => {
    const agent = await newAgent();
    const spy = new Spy();
    const created = await newTask(agent, spy.mark);

    await runner.logged('일할 수 있는 AI: claude');
    await new Promise((done) => setTimeout(done, 4_000)); // 서버가 몇 번 더 살펴볼 시간
    const held = await getTask(created.id);
    assert.equal(held.status, 'queued', '실패로 끝내지 않는다');
    assert.equal(held.attempts, 0);
    assert.deepEqual(events(held), [], '오류 기록이 쌓이지 않는다');
    assert.match(runner.logs, /AI 로그인은 콘솔의 AI 메뉴에서/);

    const token = `sk-ant-oat01-${randomUUID()}`;
    await saveToken(token);

    const seen = await spy.seen();
    assert.equal((seen.env as Json).CLAUDE_CODE_OAUTH_TOKEN, token);
    const task = await taskIn(created.id, 'done');
    await runner.logged(`${created.id}: 끝났어요`);
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
    await runner.logged('일할 수 있는 AI: claude');
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

// 배포 서버 안의 러너: 토큰 없이 서버와 함께 보는 볼륨의 연결 값으로 스스로 연결한다.
describe('서버 러너는 연결 값으로 스스로 연결한다', () => {
  test('토큰 없이 연결해 일하고, 주인이 끊으면 다시 연결해 이어 간다', async () => {
    const file = join(spyDir, 'pairing');
    writeFileSync(file, api.service(ServerRunnerPolicy).secret());
    const runner = RunnerProcess.start(api.baseUrl, {
      CAIRN_RUNNER_TOKEN: '',
      CAIRN_RUNNER_PAIRING_FILE: file,
    });
    try {
      await runner.logged('서버 러너로 연결했어요');

      const agent = await newAgent();
      const first = await newTask(agent, '');
      await taskIn(first.id, 'done');

      const { devices } = ok(await api.get('/api/devices', owner)) as {
        devices: { id: string; name: string }[];
      };
      const device = devices.find((d) => d.name === '서버 러너');
      ok(await api.request('POST', `/api/devices/${device?.id}/revoke`, owner));
      // 러너는 기다리던 next_jobs(25초)가 끝난 뒤의 다음 요청에서 거절을 알고 다시 연결한다
      await runner.logged('서버가 토큰을 거절해 다시 연결해요', 40_000);
      await until('다시 연결', () =>
        runner.logs.split('서버 러너로 연결했어요').length - 1 === 2 ? true : null,
      );

      const second = await newTask(agent, '');
      await taskIn(second.id, 'done');
      assert.equal(runner.logs.includes(api.service(ServerRunnerPolicy).secret()), false);
    } finally {
      assert.equal(await runner.stop('SIGTERM'), 0);
    }
  });
});

// 코드 러너 칸 (docs/코드작업.md 2단계): 칸마다 기기 하나로 스스로 붙고(서버 러너와 다른 연결 값), 코드 작업은 칸에게만 간다.
// 여기서는 저장소 정보(payload.code)가 없는 코드 작업이라 칸이 AI를 띄우지 않고 실패로 끝낸다. 작업 공간은 아래 '코드 작업 (작업 공간)'.
describe('코드 러너 칸', () => {
  test('칸 2개가 각자 기기로 붙고, 코드 작업은 칸 하나가 맡는다', async () => {
    const file = join(spyDir, 'code-pairing');
    const secret = api.service(ServerRunnerPolicy).codeSecret();
    writeFileSync(file, secret);
    const slots = ['1', '2'].map((slot) =>
      RunnerProcess.start(api.baseUrl, {
        CAIRN_RUNNER_TOKEN: '',
        CAIRN_RUNNER_PAIRING_FILE: file,
        CAIRN_RUNNER_SLOT: slot,
        CAIRN_SANDBOX: '1',
        CAIRN_AGENT_USER: 'self',
      }),
    );
    try {
      await slots[0]?.logged('코드 러너 칸 1로 연결했어요');
      await slots[1]?.logged('코드 러너 칸 2로 연결했어요');
      // 능력 줄은 연결 뒤 CLI 버전을 읽고 나서 찍힌다
      await Promise.all(slots.map((s) => s.logged('코드 작업만 받음')));
      const { devices } = ok(await api.get('/api/devices', owner)) as {
        devices: { name: string; scopes: string[]; revokedAt: string | null }[];
      };
      const live = devices.filter((d) => d.revokedAt === null && d.name.startsWith('코드 러너'));
      assert.deepEqual(live.map((d) => d.name).sort(), ['코드 러너 1', '코드 러너 2']);
      for (const device of live) assert.deepEqual(device.scopes, ['run', 'sandbox']);

      const coder = await newAgent({
        name: '코드 담당',
        scopes: ['read_public', 'code'],
        approvalActions: [],
      });
      const created = await newTask(coder, '', { kind: 'code' });
      const task = await taskIn(created.id, 'failed');
      assert.match(String((task.result as Json).error), /코드 작업의 저장소 정보가 틀려요/);
      const takers = slots.filter((s) => s.logs.includes(`${created.id}: 일을 맡았어요`));
      assert.equal(takers.length, 1, '칸 하나가 맡는다');
      assert.equal(
        slots.some((s) => s.logs.includes(secret)),
        false,
        '연결 값은 로그에 없다',
      );
    } finally {
      const codes = await Promise.all(slots.map((s) => s.stop('SIGTERM')));
      assert.deepEqual(codes, [0, 0]);
    }
  });
});

// 코드 작업 (docs/코드작업.md 3단계): 칸이 저장소를 받아 AI에게 셸과 함께 맡기고, 맡긴 경로 안의 변경만 cairn/<작업>에 올린다.
// GitHub 대신 이 컴퓨터의 시험용 git 서버(http-backend)에 붙는다. AI 사용자는 self(시험용): 사용자 나누기는 Docker 시험에서 본다.
describe('코드 작업 (작업 공간)', () => {
  let git: GitServer;
  let repoUrl: string;
  let work: string;
  let slot: RunnerProcess;
  let coder: Json;
  const code = (more: Json = {}) => ({
    repo: { url: repoUrl, base: 'main' },
    paths: ['src'],
    setup: 'test -f README.md',
    checks: ['test -f src/a.ts'],
    ...more,
  });
  const codeTask = (marks: string, more: Json = {}) =>
    newTask(coder, marks, { kind: 'code', payload: { code: code(more) } });
  const resultOf = (task: Json) => task.result as Json;
  const roomsLeft = () =>
    until('작업 자리를 지움', () => (readdirSync(work).length === 0 ? true : null));

  before(async () => {
    git = await GitServer.start();
    repoUrl = git.create('app', { 'src/a.ts': 'export const a = 1;\n', 'README.md': '# app\n' });
    work = mkdtempSync(join(tmpdir(), 'cairn-work-'));
    const file = join(spyDir, 'code-pairing-3');
    writeFileSync(file, api.service(ServerRunnerPolicy).codeSecret());
    slot = RunnerProcess.start(api.baseUrl, {
      CAIRN_RUNNER_TOKEN: '',
      CAIRN_RUNNER_PAIRING_FILE: file,
      CAIRN_RUNNER_SLOT: '3',
      CAIRN_SANDBOX: '1',
      CAIRN_AGENT_USER: 'self',
      CAIRN_WORK_DIR: work,
    });
    await slot.logged('코드 러너 칸 3로 연결했어요');
    coder = await newAgent({
      name: '코드 담당',
      scopes: ['read_public', 'code'],
      approvalActions: [],
    });
  });

  after(async () => {
    assert.equal(await slot.stop('SIGTERM'), 0);
    git.close();
    rmSync(work, { recursive: true, force: true });
  });

  test('저장소를 받아 셸과 함께 고치고, 맡긴 경로 안의 변경만 커밋 하나로 cairn/<작업>에 올린다', async () => {
    const spy = new Spy();
    const created = await codeTask(
      `[fake:edit=src/a.ts] [fake:edit=src/new/b.ts] [fake:outputs] ${spy.mark}`,
    );
    const task = await taskIn(created.id, 'done');
    const branch = `cairn/${created.id}`;
    const text = String(resultOf(task).text);
    assert.match(text, new RegExp(`${branch} 브랜치에 올렸어요`));
    assert.match(text, /- test -f src\/a.ts: 통과/);
    assert.deepEqual([...git.changed('app', branch)].sort(), ['src/a.ts', 'src/new/b.ts']);
    assert.equal(git.show('app', branch, 'src/new/b.ts'), '고친 내용 src/new/b.ts\n');
    assert.ok(git.head('app', 'main'), '기준 브랜치는 그대로');
    // 결과물은 저장소 밖의 자리 폴더에서 agent 권한으로 옮겨 올린다: 커밋에는 들어가지 않는다
    assert.deepEqual((task.outputs as Json[]).map((o) => o.name).sort(), [
      'chart.png',
      '보고서.md',
    ]);

    const seen = await spy.seen();
    const argv = seen.argv as string[];
    assert.match(argv[argv.indexOf('--tools') + 1] ?? '', /Bash/, '코드 작업에만 셸을 연다');
    assert.match(
      argv[argv.indexOf('--add-dir') + 1] ?? '',
      /\/outputs$/,
      '결과물 폴더를 열어 준다',
    );
    assert.match(String(seen.cwd), /\/repo$/, 'AI는 저장소 사본에서 돈다');
    assert.match(String(seen.prompt), /# 고칠 수 있는 곳\n- src/);
    assert.match(String(seen.prompt), /cairn-code 스킬을 따릅니다/);
    const env = seen.env as Record<string, string>;
    assert.equal(env.CAIRN_RUNNER_PAIRING_FILE, undefined, '러너의 설정은 AI에게 가지 않는다');
    const bodies = events(task).map((e) => String(e.body));
    assert.ok(bodies.includes('setup 통과'), bodies.join(' | '));
    assert.ok(bodies.some((b) => b.startsWith(`${branch}에 올렸어요`)));
    await roomsLeft();
  });

  test('맡긴 경로 밖을 고치면 올리지 않고 실패로 끝낸다 (어느 파일인지 적는다)', async () => {
    const created = await codeTask('[fake:edit=src/ok.ts] [fake:edit=README.md]');
    const task = await taskIn(created.id, 'failed');
    assert.match(String(resultOf(task).error), /맡긴 경로 밖을 고쳐서 올리지 않았어요: README.md/);
    assert.equal(git.head('app', `cairn/${created.id}`), null);
    await roomsLeft();
  });

  test('.github/workflows는 저장소 전체를 맡겨도 막는다', async () => {
    const created = await codeTask('[fake:edit=.github/workflows/ci.yml]', { paths: ['.'] });
    const task = await taskIn(created.id, 'failed');
    assert.match(String(resultOf(task).error), /\.github\/workflows\/ci.yml/);
    assert.equal(git.head('app', `cairn/${created.id}`), null);
  });

  test('setup이 실패하면 AI를 띄우지 않는다', async () => {
    const spy = new Spy();
    const created = await codeTask(spy.mark, { setup: 'echo 설치 실패 >&2; exit 7' });
    const task = await taskIn(created.id, 'failed');
    assert.match(
      String(resultOf(task).error),
      /setup이 코드 7로 끝나 AI를 띄우지 않았어요\n설치 실패/,
    );
    assert.equal(existsSync(spy.path), false);
    await roomsLeft();
  });

  test('검사가 실패해도 올리고, 실패한 명령과 끝부분을 결과에 적는다', async () => {
    const created = await codeTask('[fake:edit=src/c.ts]', {
      checks: ['test -f src/c.ts', 'echo 테스트 망함 >&2; exit 1'],
    });
    const task = await taskIn(created.id, 'done');
    const text = String(resultOf(task).text);
    assert.match(text, /- test -f src\/c.ts: 통과/);
    assert.match(text, /- echo 테스트 망함 >&2; exit 1: 코드 1/);
    assert.match(text, /테스트 망함/);
    assert.ok(git.head('app', `cairn/${created.id}`));
  });

  test('바꾼 파일이 없으면 올리지 않고 끝낸다. 없는 저장소는 실패', async () => {
    const quiet = await codeTask('');
    const done = await taskIn(quiet.id, 'done');
    assert.match(String(resultOf(done).text), /바꾼 파일이 없어 올리지 않았어요/);
    assert.equal(git.head('app', `cairn/${quiet.id}`), null);

    const missing = await codeTask('', { repo: { url: `${git.baseUrl}/없음.git`, base: 'main' } });
    const failed = await taskIn(missing.id, 'failed');
    assert.match(String(resultOf(failed).error), /저장소를 받지 못했어요/);
    await roomsLeft();
  });

  // 4단계: 콘솔 › 코드(code-github)로 맡긴 일. 토큰으로 push하고 draft PR을 열고(가짜 GitHub API) 결재를 올린다.
  // 주인이 승인하면 끝나고, "고쳐 달라"면 같은 브랜치에서 이어서 고쳐 같은 PR이 갱신된다
  describe('code-github로 맡긴 일: PR과 결재', () => {
    const TOKEN = 'github_pat_e2e_only_0123456789';
    let github: FakeGithubApi;
    let repo: Json;
    let merger: Json;
    const worker = () => api.service(OutboxWorker);

    /** 코드 메뉴로 일을 맡기고 생긴 작업을 찾는다 (일꾼이 없어 직접 돌린다) */
    async function ask(marks: string): Promise<string> {
      const uniq = randomUUID().slice(0, 8);
      ok(
        await api.request('POST', `/api/p/code-github/repos/${repo.id}/tasks`, owner, {
          requestId: randomUUID(),
          instruction: `고쳐 주세요 ${uniq} ${marks}`,
          paths: ['src'],
          agentId: merger.id,
        }),
      );
      const task = await until('작업이 생김', async () => {
        await worker().tick();
        const { tasks } = ok(await api.get('/api/tasks', owner)) as { tasks: Json[] };
        return tasks.find((t) => String(t.title).includes(uniq)) ?? null;
      });
      return String(task.id);
    }

    /** 결재를 기다리는 작업의 결재 */
    async function approvalOf(taskId: string): Promise<Json> {
      return until('결재가 올라옴', async () => {
        const { approvals } = ok(await api.get('/api/approvals', owner)) as { approvals: Json[] };
        return approvals.find((a) => a.taskId === taskId && a.status === 'pending') ?? null;
      });
    }

    before(async () => {
      github = await FakeGithubApi.start(TOKEN);
      const url = git.create('me/app', {
        'src/a.ts': 'export const a = 1;\n',
        'README.md': '# app\n',
      });
      ok(await api.request('POST', '/api/plugins/code-github/enable', owner));
      ok(
        await api.request('PUT', '/api/plugins/code-github/settings', owner, {
          values: { token: TOKEN, apiUrl: github.url },
        }),
      );
      repo = ok(
        await api.request('POST', '/api/p/code-github/repos', owner, {
          name: 'app',
          url,
          base: 'main',
          setup: 'test -f README.md',
          checks: ['test -f src/a.ts'],
        }),
      );
      merger = await newAgent({
        name: 'PR 담당',
        scopes: ['read_public', 'code'],
        approvalActions: ['code.pr.merge'],
      });
    });

    after(() => github.close());

    test('토큰으로 push하고 draft PR을 열어 결재를 올린다. 주인이 승인하면 작업이 끝난다', async () => {
      const taskId = await ask('[fake:edit=src/a.ts]');
      await taskIn(taskId, 'waiting');
      const branch = `cairn/${taskId}`;
      assert.deepEqual([...git.changed('me/app', branch)], ['src/a.ts']);
      const pull = github.open.find((p) => p.head === branch);
      assert.ok(pull, 'PR이 열림');
      assert.deepEqual([pull.base, pull.draft], ['main', true]);
      assert.ok(
        github.calls.every((c) => c.authorization === `Bearer ${TOKEN}`),
        'GitHub에는 패키지의 토큰으로',
      );
      const approval = await approvalOf(taskId);
      assert.equal(approval.action, 'code.pr.merge');
      assert.match(String(approval.note), /PR: https:\/\/github\.example\/me\/app\/pull\//);
      assert.match(String(approval.note), /검사 1개 통과/);
      const logs = slot.logs;
      assert.equal(logs.includes(TOKEN), false, '토큰은 로그에 없다');
      assert.equal(JSON.stringify(await getTask(taskId)).includes(TOKEN), false, '기록에도 없다');

      ok(
        await api.request('POST', `/api/approvals/${approval.id}/decide`, owner, {
          version: approval.version,
          decision: 'approve',
        }),
      );
      await until('승인 뒤 끝남', async () => {
        await worker().tick();
        return (await getTask(taskId)).status === 'done' ? true : null;
      });
      const { pulls } = ok(await api.get('/api/p/code-github/pulls', owner)) as { pulls: Json[] };
      assert.equal(pulls.find((p) => p.taskId === taskId)?.status, 'merged');
      await roomsLeft();
    });

    test('"고쳐 달라"면 같은 브랜치에서 이어서 고치고, 같은 PR이 갱신되어 새 판으로 결재가 다시 올라온다', async () => {
      const taskId = await ask('[fake:edit=src/a.ts]');
      await taskIn(taskId, 'waiting');
      const first = await approvalOf(taskId);
      const branch = `cairn/${taskId}`;
      ok(
        await api.request('POST', `/api/approvals/${first.id}/decide`, owner, {
          version: first.version,
          decision: 'revise',
          note: '테스트도 더해 주세요 [fake:edit=src/second.ts]',
        }),
      );
      const second = await until('다시 고쳐 결재가 올라옴', async () => {
        const next = await approvalOf(taskId);
        return next.id === first.id ? null : next;
      });
      const versionOf = (a: Json) => Number((a.target as Json).version);
      assert.equal(versionOf(second), versionOf(first) + 1, '판이 오른다');
      assert.deepEqual([...git.changed('me/app', branch)].sort(), ['src/a.ts', 'src/second.ts']);
      assert.equal(
        github.open.filter((p) => p.head === branch).length,
        1,
        'PR은 하나 (본문만 고침)',
      );
      assert.ok(github.calls.some((c) => c.method === 'PATCH'));
      await roomsLeft();
    });
  });
});

// 웹 AI 로그인: 주인이 AI 메뉴에서 누르면 러너가 로그인 명령을 PTY(script)에서 대신 돌린다.
// 토큰 없이 뜬 러너(서버 러너와 같은 처지)가 로그인 일만 받아 로그인하고, 받은 토큰으로 이어서 일한다.
describe('웹 AI 로그인', () => {
  let runner: RunnerProcess;
  const toolOf = async (name: string): Promise<Json> => {
    const { tools } = ok(await api.get('/api/ai', owner)) as { tools: Json[] };
    return tools.find((t) => t.tool === name) as Json;
  };
  const begin = async (name: string): Promise<string> =>
    String(ok(await api.request('POST', `/api/ai/${name}/signin`, owner)).taskId);
  const step = (name: string, wanted: string): Promise<Json> =>
    until(`${name} 로그인이 ${wanted}`, async () => {
      const signin = (await toolOf(name)).signin as Json | null;
      return signin?.step === wanted ? signin : null;
    });
  const paste = async (taskId: string, code: string): Promise<void> => {
    ok(await api.request('POST', '/api/ai/claude/signin/code', owner, { taskId, code }));
  };

  before(async () => {
    await db.sql`DELETE FROM task.ai_logins`;
    runner = RunnerProcess.start(api.baseUrl, { CLAUDE_CODE_OAUTH_TOKEN: '' });
    await runner.logged('웹 로그인: claude, codex');
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
  });

  test('Claude: 토큰 없는 러너가 로그인 일만 받아 주소를 보이고, 붙여 넣은 코드로 받은 토큰으로 이어서 일한다', async () => {
    const spy = new Spy();
    const waiting = await newTask(await newAgent(), spy.mark);
    const taskId = await begin('claude');

    const shown = await step('claude', 'waiting_code');
    assert.match(String(shown.url), /^https:\/\/claude\.ai\/oauth\/authorize\?code=true&/);
    assert.equal(shown.userCode, null);
    assert.equal(
      (await getTask(waiting.id)).status,
      'queued',
      '토큰이 없으니 다른 일은 받지 않는다',
    );

    const code = `e2e${randomUUID().replaceAll('-', '')}#state`;
    await paste(taskId, code);
    const signin = await taskIn(taskId, 'done');
    const claude = await toolOf('claude');
    assert.equal(claude.connected, true);
    assert.ok(claude.expiresAt, 'Claude 토큰은 1년');

    const token = `sk-ant-oat01-fake_${code.replace('#', '_')}`;
    const seen = await spy.seen();
    assert.equal((seen.env as Json).CLAUDE_CODE_OAUTH_TOKEN, token, '받은 토큰으로 일한다');
    await taskIn(waiting.id, 'done');

    const record = `${JSON.stringify(signin)}\n${runner.logs}`;
    for (const secret of [code, token, 'claude.ai/oauth'])
      assert.equal(record.includes(secret), false, `${secret.slice(0, 16)}… 은 기록과 로그에 없다`);
    assert.ok(runner.logs.includes(`${taskId}: 붙여 넣은 코드를 넣었어요`));
    assert.ok(runner.logs.includes(`${taskId}: 로그인했어요`));
  });

  test('Claude: 틀린 코드면 실패로 끝나고 이유를 남긴다', async () => {
    const taskId = await begin('claude');
    await step('claude', 'waiting_code');
    await paste(taskId, 'wrong-code-1234');
    const failed = await taskIn(taskId, 'failed');
    assert.match(String((failed.result as Json).error), /코드가 맞지 않거나/);
    assert.equal(JSON.stringify(failed).includes('wrong-code-1234'), false);
  });

  test('취소하면 로그인 명령을 끄고 다음 일을 받는다', async () => {
    const taskId = await begin('claude');
    await step('claude', 'waiting_code');
    await cancelTask({ id: taskId });
    await runner.logged(`${taskId}: 주인이 취소했어요`);
    const next = await begin('claude');
    assert.notEqual(next, taskId);
    await step('claude', 'waiting_code');
    await cancelTask({ id: next });
    await runner.logged(`${next}: 주인이 취소했어요`);
  });

  test('Codex: 주소와 코드를 보이고, 로그인이 끝나면 auth.json을 만료 없이 저장한다', async () => {
    const taskId = await begin('codex');
    const shown = await step('codex', 'open_url');
    assert.equal(shown.url, 'https://auth.openai.com/codex/device');
    assert.equal(shown.userCode, 'FAKE-C0DE1');

    await taskIn(taskId, 'done');
    const codex = await toolOf('codex');
    assert.equal(codex.connected, true);
    assert.equal(codex.expiresAt, null);
    const [row] =
      await db.sql`SELECT octet_length(secret) AS size FROM task.ai_logins WHERE tool = 'codex'`;
    assert.ok(Number(row?.size) > 0, '잠가서 저장했다');
    assert.equal(runner.logs.includes('fake-refresh'), false);
  });
});

// Codex 구독으로 일하기: 공식 codex exec를 셸 없이 띄우고, 실행 중에 갱신된 auth.json을 서버에 되돌려 쓴다.
describe('Codex로 일한다', () => {
  let runner: RunnerProcess;
  const codexLogin = async (): Promise<Json> => {
    const { tools } = ok(await api.get('/api/ai', owner)) as { tools: Json[] };
    return tools.find((t) => t.tool === 'codex') as Json;
  };
  const codexAgent = () => newAgent({ tool: 'codex', name: 'Codex 글쓰기' });
  /** 서버에 저장된 Codex 자격 (러너가 받는 그대로) */
  const storedAuth = async (): Promise<Json> => {
    const name = `codex-reader-${randomUUID().slice(0, 8)}`;
    const device = await api.connectDevice(owner, name);
    const { devices } = ok(await api.get('/api/devices', owner)) as {
      devices: { id: string; name: string; version: number }[];
    };
    const row = devices.find((d) => d.name === name);
    ok(
      await api.request('PATCH', `/api/devices/${row?.id}`, owner, {
        scopes: ['run'],
        version: row?.version,
      }),
    );
    const res = await api.mcp(device, 'tools/call', {
      name: 'ai_login',
      arguments: { tool: 'codex' },
    });
    const body = (res.json().result as { structuredContent: Json }).structuredContent;
    return { ...JSON.parse(String(body.token)), version: body.version };
  };

  before(async () => {
    await db.sql`DELETE FROM task.ai_logins WHERE tool = 'codex'`;
    runner = RunnerProcess.start(api.baseUrl);
    await runner.logged('일할 수 있는 AI: claude, codex');
    const { taskId } = ok(await api.request('POST', '/api/ai/codex/signin', owner));
    await taskIn(taskId, 'done');
    assert.equal((await codexLogin()).connected, true);
  });

  after(async () => {
    assert.equal(await runner.stop(), 0);
  });

  test('공식 CLI를 셸 없이 띄워 결과와 토큰을 남기고, 스킬은 지시문에 넣는다', async () => {
    const spy = new Spy();
    const created = await newTask(await codexAgent(), spy.mark, {
      kind: 'draft_post',
      title: '초안',
    });
    const seen = await spy.seen();
    const task = await taskIn(created.id, 'done');
    assert.deepEqual(task.result, { text: 'codex 끝' });
    assert.equal(tokens(task), 220, '300 - 캐시 100 + 20');
    const [run] = task.runs as Json[];
    assert.ok(run);
    assert.equal(run.cliVersion, 'codex-cli 0.164.0');
    assert.equal(run.model, null, 'codex의 이벤트에는 모델이 없다');
    const skill = run.skill as Json;
    assert.deepEqual(
      { name: skill.name, source: skill.source },
      { name: 'cairn-write', source: 'repo' },
    );
    const env = seen.env as Json;
    assert.ok(String(env.CODEX_HOME).length > 0);
    assert.notEqual(env.HOME, process.env.HOME, '빈 홈');
    assert.ok(String(env.CAIRN_RUN_TOKEN).length > 0, '작업 토큰은 환경 변수로만');
    assert.equal(env.CAIRN_RUNNER_TOKEN, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.ok(String(seen.config).includes('shell_tool = false'));
    assert.ok(String(seen.config).includes('[mcp_servers.cairn]'));
    assert.ok(String(seen.prompt).includes('# 스킬: cairn-write'), '셸이 없어 스킬은 지시문으로');
  });

  test('실행 중에 갱신된 auth.json은 서버에 되돌려 쓰고, 다음 실행은 새 자격으로 돈다', async () => {
    const before = await storedAuth();
    const first = await newTask(await codexAgent(), '[fake:rotate]');
    await taskIn(first.id, 'done');
    await runner.logged(`${first.id}: 갱신된 codex 로그인을 서버에 저장했어요`);
    const after = await storedAuth();
    assert.notEqual(
      (after.tokens as Json).refresh_token,
      (before.tokens as Json).refresh_token,
      '바뀐 갱신 토큰이 저장됐다',
    );
    assert.equal(after.version, Number(before.version) + 1);

    const spy = new Spy();
    const second = await newTask(await codexAgent(), spy.mark);
    const seen = await spy.seen();
    await taskIn(second.id, 'done');
    const home = String((seen.env as Json).CODEX_HOME);
    assert.ok(home.length > 0);
    const record = `${JSON.stringify(await getTask(second.id))}\n${runner.logs}`;
    assert.equal(
      record.includes(String((after.tokens as Json).refresh_token)),
      false,
      '자격은 어디에도 남지 않는다',
    );
  });

  test('주인이 취소해도 그사이 갱신된 자격은 저장한다', async () => {
    const before = await storedAuth();
    const created = await newTask(await codexAgent(), '[fake:rotate] [fake:hang]');
    await taskIn(created.id, 'running');
    await new Promise((done) => setTimeout(done, 1_500)); // 가짜 CLI가 auth.json을 바꿀 시간
    await cancelTask(created);
    await runner.logged(`${created.id}: 갱신된 codex 로그인을 서버에 저장했어요`);
    const after = await storedAuth();
    assert.notEqual((after.tokens as Json).refresh_token, (before.tokens as Json).refresh_token);
  });

  test('작업 토큰(환경 변수)으로 cairn MCP에 결재를 올린다', async () => {
    const created = await newTask(await codexAgent(), '[fake:approval]');
    await taskIn(created.id, 'waiting');
  });

  test('셸 명령이 보이면 끄고 failed, 답에 섞인 자격은 지운다', async () => {
    const shell = await newTask(await codexAgent(), '[fake:shell]');
    const failed = await taskIn(shell.id, 'failed');
    assert.match(String((failed.result as Json).error), /격리가 깨져 멈췄어요. 셸이 열려 있어요/);

    const leak = await newTask(await codexAgent(), '[fake:leak]');
    const done = await taskIn(leak.id, 'done');
    const refresh = String(((await storedAuth()).tokens as Json).refresh_token);
    assert.equal(JSON.stringify(done).includes(refresh), false);
    assert.ok(JSON.stringify(done).includes('[지움: 토큰]'));
  });
});

// browser-tabs 패키지: 주인이 콘솔(REST)에서 주소를 맡기면, 브라우저(CAIRN_BROWSER_URL)가 있는 러너가
// MCP로 받아 탭으로 열어 읽고 남긴다. 실제 Chromium으로 본다. 없으면 건너뛴다 (CAIRN_TEST_CHROMIUM으로 경로를 줄 수 있다)
const TAB_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>오늘의 글</title></head>
<body><h1>탭으로 읽은 본문</h1><p style="display:none">숨은 글자</p></body></html>`;

describe('브라우저 탭을 읽는다', { skip: TestChromium.skip }, () => {
  const PATH = '/api/p/browser-tabs/reads';
  let chromium: TestChromium;
  let site: Server;
  let siteUrl: string;

  const readOf = (url: string): Promise<Json> =>
    until(`${url} 읽기가 끝남`, async () => {
      const { reads } = ok(await api.get(PATH, owner)) as { reads: Json[] };
      return reads.find((r) => r.url === url && r.status !== 'requested') ?? null;
    });

  before(async () => {
    ok(await api.request('POST', '/api/plugins/browser-tabs/enable', owner));
    site = createServer((_, res) =>
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TAB_PAGE),
    );
    await new Promise<void>((done) => site.listen(0, '127.0.0.1', done));
    siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
    chromium = await TestChromium.start();
  });

  after(async () => {
    await chromium.stop();
    site.close();
    ok(await api.request('POST', '/api/plugins/browser-tabs/disable', owner));
  });

  test('맡긴 주소를 러너가 탭으로 열어 읽어 남기고, 열리지 않는 주소는 이유를 남긴다', async () => {
    const page = `${siteUrl}/private/${randomUUID()}`;
    const broken = 'http://127.0.0.1:1/nothing';
    for (const url of [page, broken]) {
      const made = await api.request('POST', PATH, owner, { url });
      assert.ok([200, 201].includes(made.status), made.text);
    }

    const runner = RunnerProcess.start(api.baseUrl, {
      CAIRN_BROWSER_URL: `${chromium.endpoint}/`,
    });
    try {
      await runner.logged('브라우저 탭 읽기를 켰어요');
      const done = await readOf(page);
      assert.equal(done.status, 'done');
      assert.equal(done.title, '오늘의 글');
      assert.match(String(done.preview), /탭으로 읽은 본문/);
      assert.doesNotMatch(String(done.preview), /숨은 글자/);

      const failed = await readOf(broken);
      assert.equal(failed.status, 'failed');
      assert.match(String(failed.error), /주소를 열지 못했어요/);

      assert.equal((await chromium.openUrls()).includes(page), false, '읽은 탭은 닫는다');
      await runner.logged('브라우저 탭을 읽었어요: 127.0.0.1');
      assert.equal(runner.logs.includes('/private/'), false, '로그에는 주소의 호스트만');
    } finally {
      runner.signal('SIGTERM');
      await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
      assert.equal(await runner.exited(), 0);
    }
  });
});

// 브라우저 작업(browse): 서버 러너가 브라우저(CAIRN_BROWSER_URL)에 붙어 있을 때만 받고, AI CLI에 Playwright MCP를 붙인다.
// 브라우저에 닿지 못하면 실패로 끝내지 않고 돌려준다. 가짜 CLI라 브라우저를 움직이지는 않는다 (그건 러너 단위 테스트가 본다).
describe('브라우저 작업', { skip: TestChromium.skip }, () => {
  let chromium: TestChromium;
  const SITE = {
    name: '시험 블로그',
    startUrl: 'https://blog.example/write',
    origins: ['https://blog.example'],
  };

  const browseAgent = async (): Promise<Json> =>
    ok(
      await api.request('POST', '/api/agents', owner, {
        requestId: randomUUID(),
        name: '브라우저 담당',
        role: '사이트의 편집기에 글을 채운다',
        tool: 'claude',
        scopes: ['read_public', 'browse'],
      }),
      201,
    );
  const browseTask = async (agent: Json, marks: string): Promise<Json> => {
    const task = await newTask(agent, marks);
    await db.sql`
      UPDATE task.tasks SET kind = 'browse', payload = ${db.sql.json({ site: SITE })}
      WHERE id = ${String(task.id)}`;
    return task;
  };
  const serverRunner = (browserUrl: string): RunnerProcess => {
    const file = join(spyDir, `pairing-${randomUUID()}`);
    writeFileSync(file, api.service(ServerRunnerPolicy).secret());
    return RunnerProcess.start(api.baseUrl, {
      CAIRN_RUNNER_TOKEN: '',
      CAIRN_RUNNER_PAIRING_FILE: file,
      CAIRN_BROWSER_URL: browserUrl,
    });
  };
  const stopRunner = async (runner: RunnerProcess): Promise<void> => {
    runner.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await runner.exited(), 0);
  };

  before(async () => {
    chromium = await TestChromium.start();
  });
  after(async () => {
    await chromium.stop();
  });

  test('브라우저에 닿지 못하면 AI를 띄우지 않고 돌려준다 (실패가 아니다)', async () => {
    const spy = new Spy();
    const task = await browseTask(await browseAgent(), spy.mark);
    const runner = serverRunner('http://127.0.0.1:1');
    try {
      await runner.logged('브라우저 작업: 받음');
      await runner.logged(`${task.id}: 브라우저에 닿지 못해 돌려줘요`);
      const back = await until('돌려줌', async () => {
        const t = await getTask(task.id);
        return events(t).some((e) => String(e.body).includes('브라우저에 닿지 못해요')) ? t : null;
      });
      assert.equal(back.status, 'queued');
      assert.equal(existsSync(spy.path), false, 'AI CLI는 뜨지 않았다');
    } finally {
      await cancelTask(task);
      await stopRunner(runner);
    }
  });

  test('서버 러너가 브라우저에 붙어 있으면 받아서, AI CLI에 사이트의 Playwright MCP를 붙인다', async () => {
    const spy = new Spy();
    const task = await browseTask(await browseAgent(), spy.mark);
    const runner = serverRunner(chromium.endpoint);
    try {
      await runner.logged('브라우저 작업: 받음');
      const seen = await spy.seen();
      await taskIn(task.id, 'done');
      const playwright = (seen.mcpServers as Json).playwright as Json;
      assert.equal(playwright.type, 'stdio');
      assert.deepEqual((playwright.args as string[]).slice(1), [
        '--cdp-endpoint',
        chromium.endpoint,
        '--allowed-origins',
        'https://blog.example',
      ]);
      assert.ok((seen.argv as string[]).includes('mcp__playwright__*'), '그 도구를 묻지 않고 허락');
      assert.match(String(seen.prompt), /# 사이트: 시험 블로그/);
      assert.equal(
        JSON.stringify(playwright).includes(String(seen.runToken)),
        false,
        '작업 토큰은 cairn에만',
      );
    } finally {
      await stopRunner(runner);
    }
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

  test('설치된 AI CLI가 없으면 일을 받지 않고 알린다. 일은 대기열에 그대로 남는다', async () => {
    const created = await newTask(await newAgent(), '');
    const bare = RunnerProcess.start(api.baseUrl, {
      CAIRN_RUNNER_CLI: '/없는/claude',
      CAIRN_RUNNER_CODEX_CLI: '/없는/codex',
    });
    await bare.logged('쓸 수 있는 AI CLI가 없어요');
    await new Promise((done) => setTimeout(done, 1_500));
    const task = await getTask(created.id);
    assert.equal(task.status, 'queued', '빌렸다 돌려주지 않는다');
    assert.equal(task.attempts, 0);
    bare.signal('SIGTERM');
    await newTask(await newAgent(), ''); // 긴 폴링을 깨워 바로 끝나게 한다
    assert.equal(await bare.exited(), 0);
  });

  test('로그인이 없는 도구의 일은 받지 않고, 다른 일은 계속 한다', async () => {
    await db.sql`DELETE FROM task.ai_logins WHERE tool = 'codex'`;
    const codexWork = await newTask(await newAgent({ tool: 'codex' }), '');
    const runner = RunnerProcess.start(api.baseUrl);
    const next = await newTask(await newAgent(), '');
    await taskIn(next.id, 'done');
    await runner.logged(`${next.id}: 끝났어요`);
    const held = await getTask(codexWork.id);
    assert.equal(held.status, 'queued', 'Codex 일은 로그인이 생길 때까지 기다린다');
    assert.equal(held.attempts, 0);
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
