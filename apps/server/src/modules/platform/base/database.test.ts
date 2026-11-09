import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, describe, test } from 'node:test';
import type { ArgumentsHost } from '@nestjs/common';
import { DomainErrorFilter } from '../http/domain-error.filter';
import { DeviceActor } from './actor';
import { BaseTool, type ToolAnswer } from './base-tool';
import { Database } from './database';
import { Busy, Conflict } from './errors';
import { McpEndpoint } from './mcp-endpoint';

// DB 연결의 시간 제한 (Database.LIMITS): 연결마다 걸리는지, 걸린 오류가 입구(REST · MCP)에서 busy가 되는지,
// 예외(unlimitedTransaction)는 그 트랜잭션만 풀리는지. 5초 · 30초를 기다리지 않게 그 트랜잭션만 값을 줄여 진짜 오류를 만든다.

const db = new Database();
after(() => db.onApplicationShutdown());

const LIMITS = Object.entries(Database.LIMITS);

/** 지금 연결의 시간 제한 세 값 */
async function settingsOf(sql: Database['sql']): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name] of LIMITS) {
    const [row] = await sql<{ value: string }[]>`SELECT current_setting(${name}) AS value`;
    out[name] = row?.value ?? '';
  }
  return out;
}

/** 진짜 잠금 대기 시간 초과 (55P03). 다른 트랜잭션이 쥔 advisory 잠금을 100ms만 기다린다 */
async function lockTimeout(): Promise<unknown> {
  const key = Math.floor(Math.random() * 1_000_000_000);
  let release = () => {};
  let locked = () => {};
  const held = new Promise<void>((r) => {
    locked = r;
  });
  const holder = db.transaction(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${key})`;
    locked();
    await new Promise<void>((r) => {
      release = r;
    });
  });
  await held;
  try {
    await db.transaction(async (tx) => {
      await tx`SELECT set_config('lock_timeout', '100ms', true)`;
      await tx`SELECT pg_advisory_xact_lock(${key})`;
    });
  } catch (error) {
    return error;
  } finally {
    release();
    await holder;
  }
  throw new Error('잠금을 얻으면 안 된다');
}

/** 진짜 긴 쿼리 시간 초과 (57014) */
async function statementTimeout(): Promise<unknown> {
  try {
    await db.transaction(async (tx) => {
      await tx`SELECT set_config('statement_timeout', '50ms', true)`;
      await tx`SELECT pg_sleep(1)`;
    });
  } catch (error) {
    return error;
  }
  throw new Error('쿼리가 끝나면 안 된다');
}

describe('DB 연결의 시간 제한', () => {
  test('풀의 연결은 LIMITS를 받고 시작한다', async () => {
    assert.deepEqual(await settingsOf(db.sql), {
      lock_timeout: '5s',
      statement_timeout: '30s',
      idle_in_transaction_session_timeout: '1min',
    });
  });

  test('잠금 대기와 긴 쿼리에 걸린 오류는 Busy, 그 밖의 오류는 null', async () => {
    assert.ok(Database.busy(await lockTimeout()) instanceof Busy);
    assert.ok(Database.busy(await statementTimeout()) instanceof Busy);
    const syntax = await db.sql`SELEC 1`.catch((error: unknown) => error);
    assert.equal(Database.busy(syntax), null);
    assert.equal(Database.busy(new Conflict('판이 달라요')), null);
    assert.equal(Database.busy(new Error('그 밖')), null);
  });

  test('unlimitedTransaction 안에서만 풀리고, 끝나면 같은 풀의 연결은 다시 LIMITS다', async () => {
    const inside = await db.unlimitedTransaction(async (tx) => {
      const values = await settingsOf(tx as unknown as Database['sql']);
      await tx`SELECT pg_sleep(0.05)`;
      return values;
    });
    assert.deepEqual(inside, {
      lock_timeout: '0',
      statement_timeout: '0',
      idle_in_transaction_session_timeout: '0',
    });
    // 풀의 연결을 한꺼번에 여럿 써서 방금 쓴 연결도 섞이게 한다
    const all = await Promise.all(Array.from({ length: 10 }, () => settingsOf(db.sql)));
    for (const values of all) assert.equal(values.lock_timeout, '5s');
  });
});

describe('입구에서 busy로 바꾸기', () => {
  test('REST: 시간 제한 오류는 503 busy, DomainError는 그대로', async () => {
    const sent: { status: number; body: object }[] = [];
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status: (status: number) => ({ json: (body: object) => sent.push({ status, body }) }),
        }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new DomainErrorFilter();
    filter.catch(await lockTimeout(), host);
    filter.catch(new Conflict('판이 달라요'), host);
    assert.deepEqual(sent, [
      { status: 503, body: { code: 'busy', message: new Busy().message } },
      { status: 409, body: { code: 'conflict', message: '판이 달라요' } },
    ]);
  });

  test('MCP: 시간 제한 오류는 isError + busy (러너가 다시 보낸다)', async () => {
    const failure = await statementTimeout();
    class SlowTool extends BaseTool {
      readonly name = 'slow';
      readonly description = '시간 제한에 걸리는 도구';
      readonly scope = 'write';
      readonly inputSchema = { properties: {} };
      readonly readOnly = true;
      async handle(): Promise<ToolAnswer> {
        throw failure;
      }
    }
    const endpoint = new McpEndpoint('cairn', 'test', () => [new SlowTool()], '');
    const actor = new DeviceActor(
      '00000000-0000-7000-8000-000000000001',
      '00000000-0000-7000-8000-000000000002',
      new Set(['write']),
    );
    const server: Server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on(
        'end',
        () => void endpoint.handle(actor, 'http://localhost', req, res, JSON.parse(raw)),
      );
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'slow', arguments: {} },
        }),
      });
      const body = (await res.json()) as {
        result: { isError: boolean; content: { text: string }[] };
      };
      assert.equal(body.result.isError, true);
      assert.equal(JSON.parse(body.result.content[0]?.text ?? '{}').code, 'busy');
    } finally {
      server.close();
      server.closeAllConnections();
    }
  });
});
