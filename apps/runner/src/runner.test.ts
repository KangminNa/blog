import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { AgentUser } from './agent-user';
import { Runner, RunnerHalted } from './runner';
import { RunnerConfig } from './runner-config';

// 러너의 고리를 가짜 MCP 서버에 붙여 본다. 도구마다 불린 횟수와 실어 보낸 값을 센다.

type Call = { tool: string; args: Record<string, unknown> };

const NO_TOKEN = 'AI 토큰을 아직 넣지 않았어요. 콘솔의 AI 메뉴에서 넣어 주세요';

let server: Server;
let url: string;
let calls: Call[];
/** 도구 하나의 답. 없으면 일이 없다고 답한다 */
let answers: Record<string, (res: ServerResponse) => void>;
const log = mock.method(console, 'log', () => {});

const result = (res: ServerResponse, structuredContent: object) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent } }));
};

const refusal = (res: ServerResponse, code: string, message: string) => {
  const content = [{ type: 'text', text: JSON.stringify({ code, message }) }];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content } }));
};

const status = (res: ServerResponse, code: number) => {
  res.writeHead(code);
  res.end('{}');
};

const noToken = (res: ServerResponse) => refusal(res, 'rule_violation', NO_TOKEN);

const aiTest = {
  task: { id: 'task-1', kind: 'ai_test', title: '연결 확인', payload: { tool: 'claude' } },
  instruction: 'ok라고만 답하세요.',
  agent: null,
  run_token: null,
};

const count = (tool: string): number => calls.filter((c) => c.tool === tool).length;

async function until(what: string, ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, `기다렸지만 오지 않음: ${what}`);
    await new Promise((done) => setTimeout(done, 10));
  }
}

function runner(claudeToken: string | null = null): Runner {
  return new Runner(new RunnerConfig(url, 'device-token', claudeToken, '/없는/claude', '/없는'));
}

/** 찍힌 로그 줄 */
function logLines(): string[] {
  return log.mock.calls.map((c) => String(c.arguments[0]));
}

function respond(req: IncomingMessage, res: ServerResponse): void {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    const { params } = JSON.parse(raw) as { params: { name: string; arguments: object } };
    calls.push({ tool: params.name, args: params.arguments as Record<string, unknown> });
    const answer = answers[params.name];
    if (answer) answer(res);
    // 긴 폴링 흉내: 바로 답하면 고리가 쉬지 않고 돈다
    else setTimeout(() => result(res, { jobs: [] }), 10);
  });
}

before(async () => {
  server = createServer(respond);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  log.mock.restore();
  server.close();
  server.closeAllConnections();
});

beforeEach(() => {
  calls = [];
  answers = {};
  log.mock.resetCalls();
});

describe('할 수 있는 것을 알리고 빌린다', () => {
  test('빌리기 전에 토큰을 묻지 않고, 가진 CLI와 로그인을 next_jobs에 싣는다', async () => {
    const loop = new Runner(
      new RunnerConfig(url, 'device-token', null, process.execPath, '/없는', null, '/없는/codex'),
    );
    const running = loop.run();
    await until('일을 물음', () => count('next_jobs') >= 1);
    loop.stop();
    await running;
    const asked = calls.find((c) => c.tool === 'next_jobs')?.args;
    assert.deepEqual(asked?.tools, ['claude']);
    assert.deepEqual(asked?.own_logins, []);
    assert.equal(asked?.wait_seconds, 25);
    assert.equal(asked?.limit, 1, '내 컴퓨터 러너는 하나씩');
    assert.equal(count('ai_login'), 0, '로그인이 있는지는 서버가 본다');
    assert.ok(logLines().some((line) => line.includes('일할 수 있는 AI: claude')));
  });

  test('빈 자리만큼 빌린다: 동시에 3개면 limit 3으로 묻는다', async () => {
    const loop = new Runner(
      new RunnerConfig(
        url,
        'device-token',
        null,
        process.execPath,
        '/없는',
        null,
        '/없는/codex',
        null,
        null,
        null,
        '/work',
        null,
        3,
      ),
    );
    const running = loop.run();
    await until('일을 물음', () => count('next_jobs') >= 1);
    loop.stop();
    await running;
    assert.equal(calls.find((c) => c.tool === 'next_jobs')?.args.limit, 3);
    assert.ok(logLines().some((line) => line.includes('동시에 하는 일: 3개까지')));
  });

  test('환경 변수에 토큰이 있으면 이 컴퓨터의 로그인으로 알린다', async () => {
    const loop = new Runner(
      new RunnerConfig(url, 'device-token', 'env-token', process.execPath, '/없는'),
    );
    const running = loop.run();
    await until('일을 물음', () => count('next_jobs') >= 1);
    loop.stop();
    await running;
    assert.deepEqual(calls.find((c) => c.tool === 'next_jobs')?.args.own_logins, ['claude']);
    assert.equal(logLines().join('\n').includes('env-token'), false, '토큰은 로그에 없다');
  });

  test('빌린 사이 토큰이 사라진 일은 돌려주고, 조금 쉬었다 다시 묻는다', async () => {
    answers.ai_login = noToken;
    answers.next_jobs = (res) => {
      answers.next_jobs = (late) => result(late, { jobs: [] });
      result(res, { jobs: [aiTest] });
    };
    answers.release_job = (res) => result(res, {});
    const loop = runner();
    const running = loop.run();

    await until('일을 돌려줌', () => count('release_job') === 1);
    const released = calls.find((c) => c.tool === 'release_job');
    assert.deepEqual(released?.args, { task_id: 'task-1', reason: NO_TOKEN });
    await new Promise((done) => setTimeout(done, 1_000));
    assert.equal(count('next_jobs'), 1, '돌려준 뒤 5초를 쉰다: 바로 다시 빌리면 되풀이된다');

    loop.stop();
    await running;
    assert.equal(count('release_job'), 1);
  });
});

describe('코드 작업 (코드 러너 칸)', () => {
  const codeJob = {
    task: {
      id: '0190f5a2-0000-7000-8000-00000000c0de',
      kind: 'code',
      title: '고치기',
      payload: {},
    },
    instruction: '버그를 고쳐 주세요',
    agent: { name: '코드 담당', role: '', tool: 'claude' },
    run_token: 'cairn_run_x',
  };

  /** 일 하나를 빌려 주고, 결과를 받으면 끝낸다 */
  async function runOnce(config: RunnerConfig): Promise<Record<string, unknown> | undefined> {
    answers.next_jobs = (res) => {
      answers.next_jobs = (late) => setTimeout(() => result(late, { jobs: [] }), 10);
      result(res, { jobs: [codeJob] });
    };
    answers.submit_result = (res) => result(res, { status: 'failed' });
    answers.report_progress = (res) => result(res, { status: 'running', cancelled: false });
    const loop = new Runner(config);
    const running = loop.run();
    await until('결과를 보냄', () => count('submit_result') === 1);
    loop.stop();
    await running;
    return calls.find((c) => c.tool === 'submit_result')?.args;
  }

  test('칸이 아닌 러너: AI를 띄우지 않고 로그인도 묻지 않고 실패로 끝낸다 (돌려주면 끝없이 다시 빌린다)', async () => {
    const sent = await runOnce(
      new RunnerConfig(url, 'device-token', null, process.execPath, '/없는', null, '/없는/codex'),
    );
    assert.equal(sent?.task_id, '0190f5a2-0000-7000-8000-00000000c0de');
    assert.equal(sent?.status, 'failed');
    assert.match(String(sent?.error), /코드 러너 칸이 아니라서/);
    assert.equal(count('ai_login'), 0);
    assert.equal(count('release_job'), 0);
  });

  test('칸: 저장소 정보가 틀리면 자리만 만들었다 지우고, AI 없이 이유와 함께 실패로 끝낸다', async () => {
    const work = await mkdtemp(join(tmpdir(), 'runner-work-'));
    try {
      const sent = await runOnce(
        new RunnerConfig(
          url,
          'device-token',
          'env-token',
          process.execPath,
          '/없는',
          null,
          '/없는/codex',
          null,
          '1',
          AgentUser.parse('self'),
          work,
        ),
      );
      assert.equal(sent?.status, 'failed');
      assert.match(String(sent?.error), /저장소 정보가 틀려요: payload.code가 없어요/);
      assert.equal(count('release_job'), 0);
      assert.equal('sandbox' in (calls.find((c) => c.tool === 'next_jobs')?.args ?? {}), false);
      assert.deepEqual(await readdir(work), [], '작업 자리는 남지 않는다');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});

describe('서버에 닿을 때의 실패', () => {
  test('기기 토큰이 틀리면 멈춘다', async () => {
    answers.next_jobs = (res) => status(res, 401);
    await assert.rejects(runner().run(), RunnerHalted);
  });

  test('run 권한이 없으면 멈춘다', async () => {
    answers.next_jobs = (res) => refusal(res, 'forbidden', "'run' 권한이 필요해요");
    await assert.rejects(runner().run(), RunnerHalted);
  });

  test('서버에 닿지 못하면 다시 묻는다', async () => {
    answers.next_jobs = (res) => {
      answers.next_jobs = (late) => setTimeout(() => result(late, { jobs: [] }), 10);
      status(res, 503);
    };
    const loop = runner();
    const running = loop.run();
    await until('다시 물음', () => count('next_jobs') >= 2);
    loop.stop();
    await running;
    assert.ok(logLines().some((line) => line.includes('다시 시도해요')));
  });
});
