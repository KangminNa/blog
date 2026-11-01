import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ClaudeStream } from './claude-stream';

const line = (value: object) => JSON.stringify(value);
const assistant = (id: string, usage: object, ...content: object[]) =>
  line({ type: 'assistant', message: { id, content, usage } });

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
