import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { Runner, RunnerHalted } from './runner';
import { RunnerConfig } from './runner-config';

// 러너의 고리를 가짜 MCP 서버에 붙여 본다. 도구마다 불린 횟수를 세서, 토큰이 없을 때 일을 빌리지 않는지 확인한다.

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
const hasToken = (res: ServerResponse) => result(res, { token: 'console-token' });

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

describe('쓸 AI 토큰이 없으면', () => {
  test('일을 빌리지 않고 기다리다가, 토큰이 생기면 다시 켜지 않아도 이어 간다', async () => {
    answers.ai_login = noToken;
    const loop = runner();
    const running = loop.run();

    await until('토큰을 두 번 물어봄', () => count('ai_login') >= 2);
    assert.equal(count('next_jobs'), 0, '토큰이 없으면 빌리지 않는다');
    assert.equal(count('release_job'), 0);
    const held = logLines().filter((line) => line.includes(NO_TOKEN));
    assert.equal(held.length, 1, '이유는 상태가 바뀔 때 한 번만 적는다');

    answers.ai_login = hasToken;
    await until('일을 빌림', () => count('next_jobs') >= 1);
    assert.equal(logLines().filter((line) => line.includes('AI 토큰을 받아')).length, 1);

    loop.stop();
    await running;
    assert.equal(logLines().join('\n').includes('console-token'), false, '토큰은 로그에 없다');
  });

  test('이유가 바뀌면 새 이유를 한 번 더 적는다', async () => {
    answers.ai_login = noToken;
    const loop = runner();
    const running = loop.run();
    await until('토큰을 물어봄', () => count('ai_login') >= 1);

    answers.ai_login = (res) => refusal(res, 'rule_violation', '만료된 토큰이에요');
    const asked = count('ai_login');
    await until('다시 물어봄', () => count('ai_login') > asked);
    await until('새 이유', () => logLines().some((line) => line.includes('만료된 토큰이에요')));

    loop.stop();
    await running;
    assert.equal(logLines().filter((line) => line.includes(NO_TOKEN)).length, 1);
  });

  test('기다리는 중에 멈출 수 있다', async () => {
    answers.ai_login = noToken;
    const loop = runner();
    const running = loop.run();
    await until('토큰을 물어봄', () => count('ai_login') >= 1);
    loop.stop();
    await running;
    assert.equal(count('next_jobs'), 0);
  });

  test('빌린 뒤에 토큰이 사라진 연결 확인은 돌려주고, 토큰이 올 때까지 다시 빌리지 않는다', async () => {
    answers.ai_login = hasToken;
    answers.next_jobs = (res) => {
      answers.ai_login = noToken;
      answers.next_jobs = (late) => result(late, { jobs: [] });
      result(res, { jobs: [aiTest] });
    };
    answers.release_job = (res) => result(res, {});
    const loop = runner();
    const running = loop.run();

    await until('일을 돌려줌', () => count('release_job') === 1);
    const released = calls.find((c) => c.tool === 'release_job');
    assert.deepEqual(released?.args, { task_id: 'task-1', reason: NO_TOKEN });
    // 돌려준 뒤 5초를 쉬고 나서 다시 토큰을 묻는다
    const asked = count('ai_login');
    await until('다시 물어봄', () => count('ai_login') > asked);
    assert.equal(count('next_jobs'), 1, '토큰이 없으니 다시 빌리지 않는다');

    loop.stop();
    await running;
    assert.equal(count('release_job'), 1);
  });
});

describe('환경 변수에 토큰이 있으면', () => {
  test('서버에 묻지 않고 바로 빌린다', async () => {
    const loop = runner('env-token');
    const running = loop.run();
    await until('일을 빌림', () => count('next_jobs') >= 1);
    loop.stop();
    await running;
    assert.equal(count('ai_login'), 0);
  });
});

describe('토큰을 물어볼 때의 실패', () => {
  test('기기 토큰이 틀리면 멈춘다', async () => {
    answers.ai_login = (res) => status(res, 401);
    await assert.rejects(runner().run(), RunnerHalted);
    assert.equal(count('next_jobs'), 0);
  });

  test('run 권한이 없으면 멈춘다', async () => {
    answers.ai_login = (res) => refusal(res, 'forbidden', "'run' 권한이 필요해요");
    await assert.rejects(runner().run(), RunnerHalted);
  });

  test('서버에 닿지 못하면 토큰이 없다고 적지 않고 다시 묻는다', async () => {
    answers.ai_login = (res) => {
      answers.ai_login = hasToken;
      status(res, 503);
    };
    const loop = runner();
    const running = loop.run();
    await until('일을 빌림', () => count('next_jobs') >= 1);
    loop.stop();
    await running;
    const lines = logLines();
    assert.ok(lines.some((line) => line.includes('다시 시도해요')));
    assert.equal(
      lines.some((line) => line.includes('AI 토큰이 없어')),
      false,
    );
  });
});
