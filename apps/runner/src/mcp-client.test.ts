import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, test } from 'node:test';
import { AccessDenied, McpClient, ServerUnreachable, ToolRefused } from './mcp-client';

let server: Server;
let url: string;
let answer: (req: IncomingMessage, res: ServerResponse) => void;
let seen: { authorization?: string; accept?: string; body: string } | null;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen = { authorization: req.headers.authorization, accept: req.headers.accept, body };
      answer(req, res);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

after(() => {
  server.close();
  server.closeAllConnections();
});

beforeEach(() => {
  seen = null;
});

const refused = (status: number, value: object) => (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

const json = (value: object) => (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

const client = () => new McpClient(url, 'device-token');

describe('MCP 부르기', () => {
  test('tools/call을 보내고 structuredContent를 돌려준다', async () => {
    answer = json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'running' } } });
    const body = await client().call('report_progress', { task_id: 'a' });
    assert.equal(body.text('status'), 'running');
    assert.equal(seen?.authorization, 'Bearer device-token');
    assert.ok(seen?.accept?.includes('text/event-stream'));
    assert.deepEqual(JSON.parse(seen?.body ?? '').params, {
      name: 'report_progress',
      arguments: { task_id: 'a' },
    });
  });

  test('도구 오류는 ToolRefused', async () => {
    const error = { code: 'rule_violation', message: '임대가 끝난 작업이에요' };
    answer = json({
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text', text: JSON.stringify(error) }] },
    });
    await assert.rejects(
      client().call('submit_result', {}),
      (e: ToolRefused) =>
        e instanceof ToolRefused &&
        e.code === 'rule_violation' &&
        e.message === '임대가 끝난 작업이에요',
    );
  });

  test('busy(서버 DB가 잠시 밀림)는 거절이 아니라 다시 보내도 되는 실패', async () => {
    const error = { code: 'busy', message: '처리가 밀려 있어요. 잠시 뒤 다시 해 주세요' };
    answer = json({
      jsonrpc: '2.0',
      id: 1,
      result: { isError: true, content: [{ type: 'text', text: JSON.stringify(error) }] },
    });
    await assert.rejects(
      client().call('report_progress', {}),
      (e: Error) =>
        e instanceof ServerUnreachable && !(e instanceof ToolRefused) && e.message.includes('밀려'),
    );
  });

  test('401은 AccessDenied. 다시 보내지 않는다', async () => {
    answer = (_req, res) => {
      res.writeHead(401);
      res.end('{}');
    };
    await assert.rejects(client().call('next_jobs', {}), AccessDenied);
  });

  test('5xx, JSON-RPC 오류, 읽지 못하는 답은 다시 보내도 되는 실패', async () => {
    const answers = [
      (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(502);
        res.end('Bad Gateway');
      },
      json({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } }),
      (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200);
        res.end('<html>');
      },
    ];
    for (const next of answers) {
      answer = next;
      await assert.rejects(client().call('next_jobs', {}), ServerUnreachable);
    }
  });

  test('서버가 이유를 적어 거절하면 그 이유를 보여 주고 다시 보낼 수 있다', async () => {
    answer = refused(422, { code: 'rule_violation', message: '사이트 주소부터 정해 주세요' });
    await assert.rejects(
      client().call('next_jobs', {}),
      (error: Error) =>
        error instanceof ServerUnreachable &&
        error.message === '서버가 422로 답했어요: 사이트 주소부터 정해 주세요',
    );
  });

  test('연결이 끊기면 다시 보내도 되는 실패', async () => {
    answer = (req) => req.socket.destroy();
    await assert.rejects(client().call('next_jobs', {}), ServerUnreachable);
  });

  test('stop이 오면 기다리지 않는다', async () => {
    answer = () => {};
    const stop = new AbortController();
    const called = client().call('next_jobs', {}, 25_000, stop.signal);
    setTimeout(() => stop.abort(), 20);
    await assert.rejects(called, ServerUnreachable);
  });
});
