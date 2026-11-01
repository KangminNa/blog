import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CairnServer } from './cairn-server';
import { McpClient, ServerUnreachable } from './mcp-client';
import { type ProgressBatch, ProgressState, RunEvent, RunResult } from './progress';
import { ProgressReporter } from './progress-reporter';
import { Redactor } from './redactor';

/** 보낸 묶음을 적어 두는 서버. failures만큼 닿지 못한다 */
class RecordingServer extends CairnServer {
  readonly batches: ProgressBatch[] = [];
  lease: Date | null = new Date(Date.now() + 60_000);

  constructor(private failures = 0) {
    super(new McpClient('http://127.0.0.1:1/mcp', 'token'));
  }

  override async report(_taskId: string, batch: ProgressBatch): Promise<ProgressState> {
    this.batches.push(batch);
    if (this.failures-- > 0) throw new ServerUnreachable('닿지 못했어요');
    return new ProgressState('running', false, false, this.lease);
  }
}

const reporterOn = (server: CairnServer, redactor = new Redactor([])) =>
  new ProgressReporter(server, 'task', redactor, new Date(Date.now() + 60_000));

const read = (body: string, tokens = 0) => new RunEvent(RunEvent.READ, body, tokens);

describe('진행 보고', () => {
  test('기록이 없으면 빈 보고를 보낸다. 빈 보고에는 request_id가 없다', async () => {
    const server = new RecordingServer();
    await reporterOn(server).send();
    assert.deepEqual(server.batches[0]?.events, []);
    assert.equal(server.batches[0]?.requestId, null);
  });

  test('응답을 잃은 묶음은 같은 request_id와 같은 기록으로 다시 보낸다', async () => {
    const server = new RecordingServer(2);
    const reporter = reporterOn(server);
    reporter.add([read('첫째', 5)]);
    await assert.rejects(reporter.send(), ServerUnreachable);
    reporter.add([read('둘째', 7)]);
    await assert.rejects(reporter.send(), ServerUnreachable);
    await reporter.send();
    assert.equal(reporter.idle, false);
    await reporter.send();

    const [first, second, third, fourth] = server.batches;
    assert.ok(first?.requestId);
    assert.equal(second?.requestId, first?.requestId);
    assert.equal(third?.requestId, first?.requestId);
    assert.deepEqual(
      third?.events.map((e) => e.body),
      ['첫째'],
    );
    assert.notEqual(fourth?.requestId, first?.requestId);
    assert.deepEqual(
      fourth?.events.map((e) => e.body),
      ['둘째'],
    );
    assert.equal(reporter.idle, true);
  });

  test('한 번에 100줄까지 나누어 보낸다', async () => {
    const server = new RecordingServer();
    const reporter = reporterOn(server);
    reporter.add(Array.from({ length: 250 }, (_, i) => read(String(i))));
    while (!reporter.idle) await reporter.send();
    assert.deepEqual(
      server.batches.map((b) => b.events.length),
      [100, 100, 50],
    );
  });

  test('이스케이프로 커지는 글도 한 번의 본문은 256KB를 넘지 않는다', async () => {
    const server = new RecordingServer();
    const reporter = reporterOn(server);
    reporter.add(Array.from({ length: 100 }, () => read('\u0001'.repeat(2_000))));
    while (!reporter.idle) await reporter.send();
    assert.ok(server.batches.length > 1);
    for (const batch of server.batches)
      assert.ok(Buffer.byteLength(JSON.stringify(batch.events)) <= 256 * 1024 + 200);
  });

  test('토큰을 먼저 지우고 자른다. NUL은 뺀다', async () => {
    const server = new RecordingServer();
    const reporter = reporterOn(server, new Redactor(['secret-token']));
    const long = `${'가'.repeat(1_995)}secret-token`;
    reporter.add([read(`앞\u0000 secret-token 뒤`), read(long)]);
    await reporter.send();
    const [short, clipped] = server.batches[0]?.events ?? [];
    assert.equal(short?.body, '앞 [지움: 토큰] 뒤');
    assert.equal(clipped?.body.length, 2_000);
    assert.equal(clipped?.body.includes('secret'), false);
  });

  test('임대가 지나면 응답 없이도 끝났음을 안다. 취소 뒤 null은 전 값을 지킨다', async () => {
    const server = new RecordingServer();
    const reporter = new ProgressReporter(
      server,
      'task',
      new Redactor([]),
      new Date(Date.now() - 1),
    );
    assert.equal(reporter.leaseOver, true);
    await reporter.send();
    assert.equal(reporter.leaseOver, false);
    server.lease = null;
    await reporter.send();
    assert.equal(reporter.leaseOver, false);
  });
});

describe('끝 알리기', () => {
  test('글을 자르고 토큰을 지운다', () => {
    const redactor = new Redactor(['secret']);
    const done = RunResult.done(`${'글'.repeat(70_000)}`, redactor);
    assert.equal(done.text?.length, 60_000);
    const failed = RunResult.failed(`secret ${'왜'.repeat(2_000)}`, redactor);
    assert.equal(failed.error?.length, 1_000);
    assert.equal(failed.error?.includes('secret'), false);
  });
});
