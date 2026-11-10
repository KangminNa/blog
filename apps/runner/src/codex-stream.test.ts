import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CodexStream } from './codex-stream';

// codex exec --json의 줄 (Codex 0.164.0의 사건 모양). 기록 · 토큰 · 마지막 답 · 실패 · 격리.

const line = (event: object) => JSON.stringify(event);
const item = (phase: 'started' | 'completed', body: object) =>
  line({ type: `item.${phase}`, item: { id: 'item_1', ...body } });

function read(...lines: string[]) {
  const stream = new CodexStream();
  const events = lines.flatMap((l) => stream.read(l));
  return { stream, events };
}

describe('codex exec --json', () => {
  test('cairn 도구는 읽기 · 쓰기로, 마지막 답과 토큰은 턴이 끝날 때', () => {
    const { stream, events } = read(
      line({ type: 'thread.started', thread_id: 't1' }),
      line({ type: 'turn.started' }),
      item('started', {
        type: 'mcp_tool_call',
        server: 'cairn',
        tool: 'search_sessions',
        arguments: { query: '러너' },
        status: 'in_progress',
      }),
      item('completed', {
        type: 'mcp_tool_call',
        server: 'cairn',
        tool: 'search_sessions',
        status: 'completed',
      }),
      item('started', {
        type: 'mcp_tool_call',
        server: 'cairn',
        tool: 'blog_save_draft',
        arguments: { title: '초안' },
      }),
      item('completed', { type: 'agent_message', text: '중간 답' }),
      item('completed', { type: 'agent_message', text: '초안을 저장했어요' }),
      line({
        type: 'turn.completed',
        usage: { input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 80 },
      }),
    );
    assert.deepEqual(
      events.map((e) => [e.kind, e.body, e.tokens]),
      [
        ['read', 'search_sessions 러너', 0],
        ['write', 'blog_save_draft 초안', 0],
        ['result', '초안을 저장했어요', 280],
      ],
      '캐시 읽기는 빼고 센다: 1200 - 1000 + 80',
    );
    assert.equal(stream.finalText, '초안을 저장했어요');
    assert.equal(stream.failure, null);
    assert.equal(stream.breach, null);
  });

  test('실패한 도구는 error, 작업 폴더의 파일 고치기는 write', () => {
    const { events } = read(
      item('completed', {
        type: 'mcp_tool_call',
        server: 'cairn',
        tool: 'blog_get_post',
        status: 'failed',
        error: { message: '없는 글이에요' },
      }),
      item('completed', {
        type: 'file_change',
        changes: [{ path: 'notes.md', kind: 'add' }],
        status: 'completed',
      }),
    );
    assert.deepEqual(
      events.map((e) => [e.kind, e.body]),
      [
        ['error', 'blog_get_post: 없는 글이에요'],
        ['write', '파일 notes.md'],
      ],
    );
  });

  test('턴이 실패하면 그 이유, 결과 없이 오류만 났어도 실패다', () => {
    const failed = read(line({ type: 'turn.failed', error: { message: 'usage limit reached' } }));
    assert.equal(failed.stream.failure, 'usage limit reached');
    const errored = read(line({ type: 'error', message: 'stream disconnected' }));
    assert.equal(errored.stream.failure, 'stream disconnected');
    const recovered = read(
      line({ type: 'error', message: 'Reconnecting... 1/5' }),
      item('completed', { type: 'agent_message', text: '됐어요' }),
      line({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    );
    assert.equal(recovered.stream.failure, null, '다시 이어져 끝났으면 실패가 아니다');
  });

  test('허락하지 않은 MCP 서버나 셸 명령이 보이면 격리가 깨진 것이다', () => {
    const stray = read(item('started', { type: 'mcp_tool_call', server: 'gmail', tool: 'send' }));
    assert.match(String(stray.stream.breach), /허락하지 않은 MCP 서버: gmail/);
    assert.deepEqual(stray.events, [], '기록으로 보내지 않는다');
    const shell = read(
      item('started', {
        type: 'command_execution',
        command: 'cat ~/.ssh/id_rsa',
        status: 'in_progress',
      }),
    );
    assert.match(String(shell.stream.breach), /셸이 열려 있어요/);
  });

  test('셸을 연 코드 작업: 셸 명령은 기록이고 격리 위반이 아니다. 실패한 명령은 오류로', () => {
    const stream = new CodexStream([CodexStream.SERVER], true);
    const events = [
      item('started', { type: 'command_execution', command: 'pnpm test', status: 'in_progress' }),
      item('completed', { type: 'command_execution', command: 'pnpm test', exit_code: 1 }),
      item('completed', { type: 'command_execution', command: 'ls', exit_code: 0 }),
    ].flatMap((l) => stream.read(l));
    assert.equal(stream.breach, null);
    assert.deepEqual(
      events.map((e) => [e.kind, e.body]),
      [
        ['write', '셸 pnpm test'],
        ['error', '셸 pnpm test: 코드 1'],
      ],
    );
  });

  test('JSON이 아니거나 모르는 줄은 넘어간다', () => {
    const { events, stream } = read(
      'Reading prompt from stdin...',
      line({ type: 'item.updated', item: {} }),
    );
    assert.deepEqual(events, []);
    assert.equal(stream.finalText, '');
  });
});
