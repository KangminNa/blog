import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AiLogins } from './ai-login';
import { Job } from './job';
import { Json } from './json';
import { AccessDenied, ServerUnreachable, ToolRefused } from './mcp-client';
import { Redactor } from './redactor';

const job = (kind: string, more: object = {}): Job =>
  Job.from(
    Json.of({
      task: { id: 'task-1', kind, title: '일', payload: {} },
      instruction: 'ok라고만 답하세요.',
      agent: { name: '글쓰기', role: '', tool: 'claude' },
      run_token: 'run-token',
      ...more,
    }),
  );

const aiTest = job('ai_test', {
  task: { id: 'task-2', kind: 'ai_test', title: '연결 확인', payload: { tool: 'claude' } },
  agent: null,
  run_token: null,
});

/** 서버의 ai_login 흉내. 불린 도구를 기억한다 */
class FakeServer {
  readonly asked: string[] = [];

  constructor(private readonly answer: () => string) {}

  async aiLogin(tool: string): Promise<string> {
    this.asked.push(tool);
    return this.answer();
  }
}

describe('AI 토큰 고르기', () => {
  test('환경 변수가 있으면 서버에 묻지 않고 그 값을 쓴다', async () => {
    const server = new FakeServer(() => 'console-token');
    const login = await new AiLogins(server, 'env-token').forJob(job('general'));
    assert.equal(login.token, 'env-token');
    assert.deepEqual(server.asked, []);
  });

  test('환경 변수가 없으면 일의 도구로 서버에서 받는다', async () => {
    const server = new FakeServer(() => 'console-token');
    const login = await new AiLogins(server, null).forJob(job('general'));
    assert.equal(login.token, 'console-token');
    assert.deepEqual(server.asked, ['claude']);
  });

  test('연결 확인은 콘솔의 토큰을 보는 일이라 환경 변수가 있어도 서버에서 받는다', async () => {
    const server = new FakeServer(() => 'console-token');
    const login = await new AiLogins(server, 'env-token').forJob(aiTest);
    assert.equal(login.token, 'console-token');
    assert.deepEqual(server.asked, ['claude']);
  });

  test('토큰이 없거나 서버에 닿지 못하면 이유를 담아 돌려준다', async () => {
    const failing = (error: Error) =>
      new AiLogins(
        new FakeServer(() => {
          throw error;
        }),
        null,
      ).forJob(job('general'));

    const refused = await failing(new ToolRefused('rule_violation', '토큰을 아직 넣지 않았어요'));
    assert.equal(refused.token, null);
    assert.equal(refused.problem, '토큰을 아직 넣지 않았어요');
    assert.equal((await failing(new ServerUnreachable('닿지 못했어요'))).token, null);
  });

  test('빈 답은 토큰이 아니다', async () => {
    const login = await new AiLogins(new FakeServer(() => ''), null).forJob(job('general'));
    assert.equal(login.token, null);
  });

  test('사람이 고쳐야 하는 오류는 러너까지 올린다', async () => {
    const failing = (error: Error) =>
      new AiLogins(
        new FakeServer(() => {
          throw error;
        }),
        null,
      ).forJob(job('general'));

    await assert.rejects(failing(new AccessDenied('기기 토큰이 맞지 않아요')), AccessDenied);
    await assert.rejects(failing(new ToolRefused('forbidden', '권한 없음')), ToolRefused);
  });
});

describe('일을 빌리기 전에', () => {
  test('환경 변수가 있으면 서버에 묻지 않는다', async () => {
    const server = new FakeServer(() => 'console-token');
    assert.equal(await new AiLogins(server, 'env-token').shortage(), null);
    assert.deepEqual(server.asked, []);
  });

  test('콘솔 토큰이 있으면 null, 값은 돌려주지 않는다', async () => {
    const server = new FakeServer(() => 'console-token');
    assert.equal(await new AiLogins(server, null).shortage(), null);
    assert.deepEqual(server.asked, ['claude']);
  });

  test('없으면 서버가 말한 이유, 빈 답도 없는 것이다', async () => {
    const refused = new FakeServer(() => {
      throw new ToolRefused('rule_violation', '만료된 토큰이에요');
    });
    assert.equal(await new AiLogins(refused, null).shortage(), '만료된 토큰이에요');
    assert.ok(await new AiLogins(new FakeServer(() => ''), null).shortage());
  });

  test('서버에 닿지 못한 것과 사람이 고쳐야 하는 오류는 던진다', async () => {
    const failing = (error: Error) =>
      new AiLogins(
        new FakeServer(() => {
          throw error;
        }),
        null,
      ).shortage();

    await assert.rejects(failing(new ServerUnreachable('닿지 못했어요')), ServerUnreachable);
    await assert.rejects(failing(new AccessDenied('기기 토큰이 맞지 않아요')), AccessDenied);
    await assert.rejects(failing(new ToolRefused('forbidden', '권한 없음')), ToolRefused);
  });
});

describe('연결 확인 일', () => {
  test('에이전트도 run_token도 없이 읽고, 도구는 payload에서 찾는다', () => {
    assert.equal(aiTest.isAiTest, true);
    assert.equal(aiTest.tool, 'claude');
    assert.equal(aiTest.runToken, null);
    assert.equal(aiTest.prompt(false), 'ok라고만 답하세요.');
  });

  test('보통 일의 모양은 그대로다', () => {
    const general = job('general');
    assert.equal(general.isAiTest, false);
    assert.equal(general.tool, 'claude');
    assert.equal(general.runToken, 'run-token');
  });
});

describe('토큰 지우기', () => {
  const secret = 'sk-ant-oat01-Ab_c-123';

  test('받은 값을 지운다', () => {
    const redactor = new Redactor(['device']).with('plain-value');
    assert.equal(redactor.clean('device plain-value'), '[지움: 토큰] [지움: 토큰]');
  });

  test('값을 몰라도 Anthropic 토큰 모양이면 지운다', () => {
    assert.equal(new Redactor([]).clean(`실패: ${secret}.`), '실패: [지움: 토큰].');
  });

  test('없거나 빈 값은 글을 망가뜨리지 않는다', () => {
    assert.equal(new Redactor(['', null]).with(null).with('').clean('그대로'), '그대로');
  });
});
