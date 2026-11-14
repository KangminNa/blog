import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Connection } from '../src/connection.js';
import { Mcp, readReply } from '../src/mcp.js';
import { FakeFetch, MemoryStore } from './fakes.js';

const SITE = 'https://blog.example.com';

const ok = (value) =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: value } });
const refused = (text) =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ text }] } });

describe('MCP 응답 읽기', () => {
  it('JSON과 스트림(SSE)의 structuredContent', () => {
    assert.deepEqual(readReply(200, ok({ item_id: 'i1', status: 'saved' })), {
      value: { item_id: 'i1', status: 'saved' },
    });
    const sse = `event: message\ndata: ${ok({ approvals: 1 })}\n\n`;
    assert.deepEqual(readReply(200, sse), { value: { approvals: 1 } });
  });

  it('도구의 거절은 서버의 code · message', () => {
    const text = JSON.stringify({ code: 'too_long', message: '글이 너무 길어요' });
    assert.deepEqual(readReply(200, refused(text)), {
      refused: { code: 'too_long', message: '글이 너무 길어요' },
    });
    assert.deepEqual(readReply(200, refused('알 수 없는 도구')), {
      refused: { code: 'error', message: '알 수 없는 도구' },
    });
  });

  it('401은 토큰 문제, 그 밖의 실패 · 깨진 답 · JSON-RPC 오류는 Problem', () => {
    assert.deepEqual(readReply(401, ''), { unauthorized: true });
    assert.throws(() => readReply(500, ''), /서버가 500로 답했어요/);
    assert.throws(() => readReply(200, '<html>'), /읽지 못했어요/);
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'nope' } });
    assert.throws(() => readReply(200, rpc), /서버가 받지 않았어요: nope/);
  });
});

describe('도구 부르기', () => {
  function setup(answers) {
    const store = new MemoryStore({
      connection: {
        site: SITE,
        mcp: `${SITE}/mcp`,
        tokenEndpoint: `${SITE}/oauth/token`,
        clientId: 'client-1',
        accessToken: 'access-0',
        refreshToken: 'refresh-0',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });
    const blog = new FakeFetch({
      [`POST ${SITE}/mcp`]: () => answers.shift(),
      [`POST ${SITE}/oauth/token`]: () => ({
        body: { access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 },
      }),
    });
    const connection = new Connection({
      store,
      fetch: blog.fetch,
      launch: async () => '',
      redirectUri: 'https://x.chromiumapp.org/',
    });
    return { blog, mcp: new Mcp({ connection, fetch: blog.fetch }) };
  }

  it('JSON-RPC tools/call을 Bearer 토큰으로 보낸다', async () => {
    const { blog, mcp } = setup([{ body: ok({ approvals: 2, questions: 1 }) }]);
    assert.deepEqual(await mcp.call('inbox', {}), { approvals: 2, questions: 1 });
    const [call] = blog.to(`${SITE}/mcp`);
    assert.equal(call.headers.authorization, 'Bearer access-0');
    assert.deepEqual(call.json, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'inbox', arguments: {} },
    });
  });

  it('401이면 한 번 갱신하고 새 토큰으로 다시 부른다', async () => {
    const { blog, mcp } = setup([{ status: 401, body: '' }, { body: ok({ status: 'saved' }) }]);
    assert.deepEqual(await mcp.call('keep_page', { url: 'https://a.example' }), {
      status: 'saved',
    });
    const calls = blog.to(`${SITE}/mcp`).map((call) => call.headers.authorization);
    assert.deepEqual(calls, ['Bearer access-0', 'Bearer access-1']);
    assert.equal(blog.to(`${SITE}/oauth/token`).length, 1);
  });

  it('갱신한 토큰도 받지 않으면 · 거절이면 Problem', async () => {
    const twice = setup([
      { status: 401, body: '' },
      { status: 401, body: '' },
    ]);
    await assert.rejects(twice.mcp.call('inbox', {}), /다시 연결해 주세요/);
    const text = JSON.stringify({ code: 'forbidden', message: '이 기기는 맡길 수 없어요' });
    const no = setup([{ body: refused(text) }]);
    await assert.rejects(no.mcp.call('ask_agent', {}), {
      code: 'forbidden',
      message: '이 기기는 맡길 수 없어요',
    });
  });
});
