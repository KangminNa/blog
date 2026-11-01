import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ClaudeStream } from './claude-stream';

const line = (value: object) => JSON.stringify(value);
const assistant = (id: string, usage: object, ...content: object[]) =>
  line({ type: 'assistant', message: { id, content, usage } });

/** 실제 실행에서 받은 줄 (2026-11-01) */
const RATE_LIMIT_LINE =
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1793536800,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"five_hour":{"utilization":0.72,"resetsAt":1793536800},"seven_day":{"utilization":0.19,"resetsAt":1793919600}}}}';

const rateLimit = (info: object) => line({ type: 'rate_limit_event', rate_limit_info: info });
const planOf = (stream: ClaudeStream) => JSON.parse(JSON.stringify(stream.takePlanUsage()));

describe('구독 사용률 읽기', () => {
  test('실제 줄의 두 창을 읽는다. 기록은 남기지 않는다', () => {
    const stream = new ClaudeStream();
    assert.deepEqual(stream.read(RATE_LIMIT_LINE), []);
    assert.deepEqual(planOf(stream), [
      {
        window: 'five_hour',
        percent: 72,
        resets_at: '2026-11-01T12:40:00.000Z',
        status: 'allowed',
      },
      {
        window: 'seven_day',
        percent: 19,
        resets_at: '2026-11-05T23:00:00.000Z',
        status: 'allowed',
      },
    ]);
  });

  test('꺼낸 뒤에는 비어 있고, 여러 번 오면 가장 최근 값만 남는다', () => {
    const stream = new ClaudeStream();
    assert.deepEqual(stream.takePlanUsage(), []);
    stream.read(RATE_LIMIT_LINE);
    stream.read(
      rateLimit({
        status: 'allowed_warning',
        unifiedWindows: { five_hour: { utilization: 0.91, resetsAt: 1793536800 } },
      }),
    );
    const plan = planOf(stream);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].percent, 91);
    assert.equal(plan[0].status, 'allowed_warning');
    assert.deepEqual(stream.takePlanUsage(), []);
  });

  test('초과 사용은 100을 넘는다', () => {
    const stream = new ClaudeStream();
    stream.read(
      rateLimit({
        status: 'rejected',
        unifiedWindows: { five_hour: { utilization: 1.04, resetsAt: 1793536800 } },
      }),
    );
    assert.equal(planOf(stream)[0].percent, 104);
  });

  test('모르는 창은 넘어간다', () => {
    const stream = new ClaudeStream();
    stream.read(
      rateLimit({
        status: 'allowed',
        unifiedWindows: {
          one_hour: { utilization: 0.5, resetsAt: 1793536800 },
          five_hour: { utilization: 0.1, resetsAt: 1793536800 },
        },
      }),
    );
    assert.deepEqual(
      planOf(stream).map((p: { window: string }) => p.window),
      ['five_hour'],
    );
  });

  test('상태를 모르면 사용률만 보낸다', () => {
    const stream = new ClaudeStream();
    for (const status of [undefined, 'allowed_new', 7]) {
      stream.read(
        rateLimit({
          status,
          unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1793536800 } },
        }),
      );
      assert.deepEqual(planOf(stream), [
        { window: 'five_hour', percent: 10, resets_at: '2026-11-01T12:40:00.000Z' },
      ]);
    }
  });

  test('깨진 줄은 넘어가고 앞의 값을 지킨다', () => {
    const stream = new ClaudeStream();
    stream.read(RATE_LIMIT_LINE);
    const broken: readonly string[] = [
      line({ type: 'rate_limit_event' }),
      line({ type: 'rate_limit_event', rate_limit_info: null }),
      line({ type: 'rate_limit_event', rate_limit_info: [] }),
      rateLimit({ status: 'allowed' }),
      rateLimit({ status: 'allowed', resetsAt: 1793536800, rateLimitType: 'five_hour' }),
      rateLimit({ status: 'allowed', unifiedWindows: 'many' }),
      rateLimit({ status: 'allowed', unifiedWindows: { five_hour: null } }),
      rateLimit({ status: 'allowed', unifiedWindows: { five_hour: {} } }),
      rateLimit({ unifiedWindows: { five_hour: { utilization: 0.5 } } }),
      rateLimit({ unifiedWindows: { five_hour: { resetsAt: 1793536800 } } }),
      rateLimit({ unifiedWindows: { five_hour: { utilization: '0.5', resetsAt: 1793536800 } } }),
      rateLimit({ unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: '내일' } } }),
      rateLimit({ unifiedWindows: { five_hour: { utilization: -0.5, resetsAt: 1793536800 } } }),
      rateLimit({ unifiedWindows: { five_hour: { utilization: 11, resetsAt: 1793536800 } } }),
      rateLimit({ unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 0 } } }),
      rateLimit({ unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 1e20 } } }),
      '{"type":"rate_limit_event","rate_limit_info":{"status":"all',
    ];
    for (const text of broken) assert.deepEqual(stream.read(text), [], text);
    assert.equal(planOf(stream)[0].percent, 72);
  });

  test('창 하나가 깨져도 나머지 창은 쓴다', () => {
    const stream = new ClaudeStream();
    stream.read(
      rateLimit({
        unifiedWindows: {
          five_hour: { utilization: 'x', resetsAt: 1793536800 },
          seven_day: { utilization: 0.19, resetsAt: 1793919600 },
        },
      }),
    );
    assert.deepEqual(
      planOf(stream).map((p: { window: string }) => p.window),
      ['seven_day'],
    );
  });
});

describe('Claude 출력 읽기', () => {
  test('읽는 도구는 read, 나머지는 write. 입력 내용은 남기지 않는다', () => {
    const stream = new ClaudeStream();
    const events = [
      ...stream.read(
        assistant('a', {}, { type: 'tool_use', name: 'Read', input: { file_path: 'a.md' } }),
      ),
      ...stream.read(
        assistant('b', {}, { type: 'tool_use', name: 'mcp__cairn__get_session', input: {} }),
      ),
      ...stream.read(
        assistant(
          'c',
          {},
          { type: 'tool_use', name: 'mcp__cairn__blog_save_draft', input: { body: '비밀 본문' } },
        ),
      ),
      ...stream.read(assistant('d', {}, { type: 'tool_use', name: '새도구', input: {} })),
    ];
    assert.deepEqual(
      events.map((e) => [e.kind, e.body]),
      [
        ['read', 'Read a.md'],
        ['read', 'get_session'],
        ['write', 'blog_save_draft'],
        ['write', '새도구'],
      ],
    );
  });

  test('같은 message.id의 usage는 늘어난 만큼만 세고, cache_read는 넣지 않는다', () => {
    const stream = new ClaudeStream();
    const usage = {
      input_tokens: 100,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 9000,
      output_tokens: 5,
    };
    const tool = { type: 'tool_use', name: 'Read', input: {} };
    const first = stream.read(assistant('m', usage, tool));
    const second = stream.read(assistant('m', usage, tool));
    const grown = stream.read(assistant('m', { ...usage, output_tokens: 8 }, tool));
    assert.deepEqual(
      [first, second, grown].map((events) => events[0]?.tokens),
      [115, 0, 3],
    );
  });

  test('글만 있는 메시지의 토큰은 다음 기록에 실린다', () => {
    const stream = new ClaudeStream();
    assert.deepEqual(
      stream.read(assistant('m', { input_tokens: 7 }, { type: 'text', text: '생각 중' })),
      [],
    );
    const [event] = stream.read(
      line({ type: 'result', subtype: 'success', result: '끝', usage: { input_tokens: 7 } }),
    );
    assert.deepEqual([event?.kind, event?.body, event?.tokens], ['result', '끝', 7]);
    assert.equal(stream.finalText, '끝');
  });

  test('result의 modelUsage가 더 크면 모자란 만큼 더한다', () => {
    const stream = new ClaudeStream();
    stream.read(assistant('m', { input_tokens: 10 }, { type: 'text', text: '답' }));
    const [event] = stream.read(
      line({
        type: 'result',
        subtype: 'success',
        result: '답',
        usage: { input_tokens: 10 },
        modelUsage: {
          a: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0 },
          b: { inputTokens: 20, outputTokens: 0, cacheCreationInputTokens: 1 },
        },
      }),
    );
    assert.equal(event?.tokens, 36);
  });

  test('실패한 result는 error이고 이유를 기억한다', () => {
    const stream = new ClaudeStream();
    const [event] = stream.read(
      line({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['턴 초과'] }),
    );
    assert.equal(event?.kind, 'error');
    assert.equal(stream.failure, '턴 초과');
  });

  test('result가 없으면 마지막 글이 답이다', () => {
    const stream = new ClaudeStream();
    stream.read(assistant('m', {}, { type: 'text', text: '중간까지 썼어요' }));
    assert.equal(stream.finalText, '중간까지 썼어요');
    assert.equal(stream.failure, null);
  });

  test('실패한 tool_result는 error로 남긴다', () => {
    const stream = new ClaudeStream();
    const text = line({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', content: '성공' },
          { type: 'tool_result', is_error: true, content: [{ type: 'text', text: '실패' }] },
        ],
      },
    });
    assert.deepEqual(
      stream.read(text).map((e) => [e.kind, e.body]),
      [['error', '실패']],
    );
  });

  test('cairn 말고 다른 MCP 서버가 붙으면 알아챈다', () => {
    const stream = new ClaudeStream();
    stream.read(
      line({
        type: 'system',
        subtype: 'init',
        mcp_servers: [
          { name: 'cairn', status: 'connected' },
          { name: 'claude.ai Gmail', status: 'connected' },
        ],
      }),
    );
    assert.deepEqual(stream.stray, ['claude.ai Gmail']);
  });

  test('cairn에 붙지 못하면 기록에 남긴다', () => {
    const stream = new ClaudeStream();
    const events = stream.read(
      line({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'cairn', status: 'failed' }] }),
    );
    assert.deepEqual(stream.stray, []);
    assert.equal(events[0]?.kind, 'error');
  });

  test('API 재시도는 error로 남긴다', () => {
    const [event] = new ClaudeStream().read(
      line({
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 10,
        error: 'rate_limit',
      }),
    );
    assert.equal(event?.body, 'API 재시도 2/10: rate_limit');
  });

  test('JSON이 아니거나 모르는 줄은 넘어간다', () => {
    const stream = new ClaudeStream();
    for (const text of ['', '경고: 뭔가', '[1,2]', 'null', line({ type: 'stream_event' })])
      assert.deepEqual(stream.read(text), []);
  });

  test('끝내지 못한 실행의 토큰은 finish가 돌려준다', () => {
    const stream = new ClaudeStream();
    stream.read(assistant('m', { output_tokens: 9 }, { type: 'text', text: '쓰는 중' }));
    assert.deepEqual(
      stream.finish().map((e) => e.tokens),
      [9],
    );
    assert.deepEqual(stream.finish(), []);
  });
});
