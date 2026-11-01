import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, type TestContext, test } from 'node:test';
import { ArchiveQuery } from '../archive/archive.query';
import { BaseHandler } from '../base/base-handler';
import { BaseJob } from '../base/base-job';
import { Database } from '../base/database';
import { DomainEvent } from '../base/event';
import { ChangeSignal, Outbox } from '../base/outbox';
import { SecretBox } from '../base/secret-box';
import { PluginRegistry } from '../plugin/plugin-registry';
import { CoreWorkers } from './core-workers';
import { OutboxWorker } from './outbox-worker';

// 서버 코드를 가진 플러그인을 불러오고, 일꾼이 outbox 이벤트를 넘기는지 실제 DB로 확인한다.

const db = new Database();
const archive = new ArchiveQuery(db);
const box = SecretBox.fromEnv({});
after(async () => {
  await db.sql`DELETE FROM platform.plugins WHERE name = 'probe'`;
  await db.onApplicationShutdown();
});

/** 플러그인을 켠 상태로 DB에 적고 목록을 띄운다 (켤 때 허락한 확장 지점 = granted) */
async function bootWith(root: string, granted: readonly string[]): Promise<PluginRegistry> {
  await db.sql`
    INSERT INTO platform.plugins (name, enabled, version, granted_uses) VALUES ('probe', true, '0.1.0', ${granted as string[]})
    ON CONFLICT (name) DO UPDATE SET enabled = true, granted_uses = EXCLUDED.granted_uses`;
  return PluginRegistry.boot(root, db.sql, archive, box);
}

const API = resolve(__dirname, '../../../plugin-api');
const SPACE = '00000000-0000-7000-8000-00000000f00d';
const emptyRegistry = () =>
  PluginRegistry.boot(mkdtempSync(join(tmpdir(), 'cairn-core-')), db.sql, archive, box);

/** 받은 이벤트를 전역 배열에 적고, ".failed" 이벤트는 실패하는 테스트 플러그인 */
function makePlugin(uses: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'cairn-worker-'));
  const dir = join(root, 'probe');
  mkdirSync(join(dir, 'server'), { recursive: true });
  writeFileSync(
    join(dir, 'cairn-plugin.json'),
    JSON.stringify({
      name: 'probe',
      version: '0.1.0',
      cairn: '>=0.1',
      server: 'server/plugin.ts',
      uses,
    }),
  );
  writeFileSync(
    join(dir, 'server/plugin.ts'),
    `import { BasePlugin, BaseHandler, BaseJob, ActionResult, BaseAction } from '${API}';
     const seen = ((globalThis as any).__probeSeen ??= []);
     class Probe extends BaseHandler {
       async handle(e: any) { if (e.name.endsWith('.failed')) throw new Error('일부러 실패'); seen.push(e.name); }
     }
     class Tick extends BaseJob { readonly name = 'tick'; async run() { seen.push('job'); } }
     class Hello extends BaseAction { readonly label = '인사'; async run() { return ActionResult.done('안녕'); } }
     export default class ProbePlugin extends BasePlugin {
       register(cairn: any) {
         cairn.onEvent('vault.testprobe.*', new Probe());
         cairn.every('10s', new Tick());
         cairn.addAction('hello', new Hello());
       }
     }`,
  );
  return root;
}

const seen = (): string[] =>
  ((globalThis as Record<string, unknown>).__probeSeen as string[]) ?? [];

describe('플러그인 서버 코드', () => {
  test('켜져 있고 허락한 확장 지점으로 등록된다', async () => {
    const root = makePlugin(['event:vault.testprobe.*', 'job:tick', 'action:hello']);
    const registry = await bootWith(root, ['event:vault.testprobe.*', 'job:tick', 'action:hello']);
    assert.equal(registry.jobs().length, 1);
    const hello = registry.action('probe', 'hello');
    assert.equal((await hello?.action.run(null as never))?.message, '안녕');
  });

  test('목록 파일에 없는 확장 지점을 쓰면 그 플러그인만 동작하지 않고 이유가 남는다', async () => {
    const root = makePlugin(['job:tick', 'action:hello']);
    const registry = await bootWith(root, ['job:tick', 'action:hello']);
    assert.match(
      registry.problem('probe') ?? '',
      /목록 파일에 없는 확장 지점.*event:vault\.testprobe\.\*/,
    );
    assert.equal(registry.jobs().length, 0);
  });
});

describe('일꾼', () => {
  test('이벤트를 넘기고, 실패한 것은 늦춰서 다시 시도하도록 남긴다', async () => {
    const root = makePlugin(['event:vault.testprobe.*', 'job:tick', 'action:hello']);
    const worker = new OutboxWorker(
      db,
      await bootWith(root, ['event:vault.testprobe.*', 'job:tick', 'action:hello']),
      new CoreWorkers(),
    );
    await db.sql`DELETE FROM platform.outbox WHERE space_id = ${SPACE}`;
    await db.sql`
      INSERT INTO platform.outbox (space_id, topic, payload) VALUES
        (${SPACE}, 'vault.testprobe.saved', '{"v":1,"id":"a"}'),
        (${SPACE}, 'vault.testprobe.failed', '{"v":1}'),
        (${SPACE}, 'blog.other.saved', '{"v":1}')`;
    await worker.tick();

    assert.ok(seen().includes('vault.testprobe.saved'));
    const rows = await db.sql`
      SELECT topic, processed_at IS NOT NULL AS done, attempts, last_error,
             next_attempt_at > now() + interval '10 seconds' AS later
        FROM platform.outbox WHERE space_id = ${SPACE} ORDER BY id`;
    const by = new Map(rows.map((r) => [String(r.topic), r]));
    assert.equal(by.get('vault.testprobe.saved')?.done, true);
    assert.equal(
      by.get('blog.other.saved')?.done,
      true,
      '받는 쪽이 없는 이벤트도 처리됨으로 넘어간다',
    );
    const failed = by.get('vault.testprobe.failed');
    assert.equal(failed?.done, false);
    assert.equal(failed?.attempts, 1);
    assert.equal(failed?.last_error, '일부러 실패');
    assert.equal(failed?.later, true);
    await db.sql`DELETE FROM platform.outbox WHERE space_id = ${SPACE}`;
  });

  test('반복 작업은 앞 실행이 안 끝났으면 건너뛴다', async () => {
    const root = makePlugin(['event:vault.testprobe.*', 'job:tick', 'action:hello']);
    const registry = await bootWith(root, ['event:vault.testprobe.*', 'job:tick', 'action:hello']);
    const worker = new OutboxWorker(db, registry, new CoreWorkers());
    const before = seen().filter((s) => s === 'job').length;
    const job = registry.jobs()[0];
    assert.ok(job);
    await Promise.all([worker.runJob(job), worker.runJob(job)]);
    assert.equal(seen().filter((s) => s === 'job').length, before + 1);
  });
});

describe('재시작 없이 켜고 끄기', () => {
  test('platform.plugin.changed 이벤트를 받으면 일꾼이 다시 등록한다', async () => {
    const root = makePlugin(['event:vault.testprobe.*', 'job:tick', 'action:hello']);
    await db.sql`DELETE FROM platform.plugins WHERE name = 'probe'`;
    const registry = await PluginRegistry.boot(root, db.sql, archive, box);
    const worker = new OutboxWorker(db, registry, new CoreWorkers());
    assert.equal(registry.jobs().length, 0, '처음엔 꺼져 있음');

    await db.sql`
      INSERT INTO platform.plugins (name, enabled, version, granted_uses)
      VALUES ('probe', true, '0.1.0', ${['event:vault.testprobe.*', 'job:tick', 'action:hello']})`;
    await db.sql`
      INSERT INTO platform.outbox (space_id, topic, payload)
      VALUES ('00000000-0000-0000-0000-000000000000', 'platform.plugin.changed', '{"v":1,"plugin":"probe"}')`;
    await worker.tick();
    assert.equal(registry.jobs().length, 1, '이벤트를 받고 켜진 상태로 다시 등록됨');
  });
});

describe('코어 일꾼', () => {
  class Recorder extends BaseHandler {
    readonly names: string[] = [];
    async handle(event: DomainEvent): Promise<void> {
      this.names.push(event.name);
    }
  }
  class Failing extends BaseHandler {
    async handle(): Promise<void> {
      throw new Error('코어 실패');
    }
  }
  class Count extends BaseJob {
    readonly name = 'count';
    runs = 0;
    async run(): Promise<void> {
      this.runs++;
    }
  }

  test('코어 Handler가 이벤트를 받고, 실패하면 다시 시도하도록 남긴다', async () => {
    await db.sql`DELETE FROM platform.outbox WHERE space_id = ${SPACE}`;
    await db.sql`
      INSERT INTO platform.outbox (space_id, topic, payload) VALUES
        (${SPACE}, 'task.testcore.done', '{"v":1}'),
        (${SPACE}, 'task.testcore.broken', '{"v":1}')`;
    const core = new CoreWorkers();
    const recorder = new Recorder();
    core.on('task.testcore.done', recorder);
    core.on('task.testcore.broken', new Failing());
    await new OutboxWorker(db, await emptyRegistry(), core).tick();

    assert.deepEqual(recorder.names, ['task.testcore.done']);
    const rows = await db.sql`
      SELECT topic, processed_at IS NOT NULL AS done, last_error
        FROM platform.outbox WHERE space_id = ${SPACE} ORDER BY id`;
    assert.equal(rows[0]?.done, true);
    assert.equal(rows[1]?.done, false);
    assert.equal(rows[1]?.last_error, '코어 실패');
  });

  test('주제 형식이 틀린 이벤트는 그것만 실패로 남고 뒤의 이벤트는 처리된다', async () => {
    const core = new CoreWorkers();
    const seen: string[] = [];
    core.on(
      'probe.core.after_bad',
      new (class extends BaseHandler {
        async handle(event: DomainEvent): Promise<void> {
          seen.push(event.name);
        }
      })(),
    );
    const rows = await db.sql`
      INSERT INTO platform.outbox (space_id, topic, payload) VALUES
        (${SPACE}, 'bad topic', '{"v":1}'), (${SPACE}, 'probe.core.after_bad', '{"v":1}')
      RETURNING id`;
    await new OutboxWorker(db, await emptyRegistry(), core).tick();
    assert.deepEqual(seen, ['probe.core.after_bad']);
    const [bad] = await db.sql`SELECT last_error FROM platform.outbox WHERE id = ${rows[0]?.id}`;
    assert.match(String(bad?.last_error), /이벤트 이름 형식/);
    await db.sql`DELETE FROM platform.outbox WHERE id = ${rows[0]?.id}`;
  });

  test('필수 주제에 받는 쪽이 없으면 일꾼이 시작하지 않는다', async () => {
    const core = new CoreWorkers();
    core.expect('task.approval.granted');
    core.expect('blog.post.published');
    core.on('blog.post.*', new Recorder());
    assert.deepEqual(core.missing(), ['task.approval.granted']);
    const worker = new OutboxWorker(db, await emptyRegistry(), core);
    assert.throws(() => worker.start(), /task\.approval\.granted/);
  });

  test('코어 반복 작업도 같은 방식으로 돈다', async () => {
    const core = new CoreWorkers();
    const job = new Count();
    core.every(job, 60_000);
    const worker = new OutboxWorker(db, await emptyRegistry(), core);
    const [scheduled] = core.jobs();
    assert.ok(scheduled);
    await worker.runJob(scheduled);
    assert.equal(job.runs, 1);
  });
});

describe('신호로 깨우기', () => {
  const HOUR = 3_600_000; // 주기를 길게 두면 신호로만 처리된다
  const LIMIT = { timeout: 15_000 };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  after(() => db.sql`DELETE FROM platform.outbox WHERE space_id = ${SPACE}`);

  /** 조건이 맞을 때까지 기다린다. 시간이 다 되면 실패 */
  async function until(done: () => boolean, ms = 5000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!done()) {
      assert.ok(Date.now() < deadline, '기다린 일이 일어나지 않았어요');
      await sleep(5);
    }
  }

  /** 끝낸 바퀴를 세고, 한 바퀴를 일부러 실패시킬 수 있는 일꾼 */
  class WatchedWorker extends OutboxWorker {
    ticks = 0;
    failNext = false;

    override async tick(): Promise<number> {
      try {
        if (this.failNext) {
          this.failNext = false;
          throw new Error('일부러 실패');
        }
        return await super.tick();
      } finally {
        this.ticks++;
      }
    }
  }

  /** 듣기를 세고, 일부러 실패시킬 수 있는 DB */
  class ProbeDatabase extends Database {
    listens = 0;
    unlistens = 0;
    broken = false;

    override async listen(
      channel: string,
      onMessage: (payload: string) => void,
      onReady?: () => void,
    ): Promise<() => Promise<void>> {
      this.listens++;
      if (this.broken) throw new Error('듣기 실패');
      const unlisten = await super.listen(channel, onMessage, onReady);
      return () => {
        this.unlistens++;
        return unlisten();
      };
    }
  }

  /** 받은 이벤트를 적고, hold가 풀릴 때까지 붙들고 있는 받는 쪽 */
  class Inbox extends BaseHandler {
    readonly names: string[] = [];
    hold: Promise<void> = Promise.resolve();

    async handle(event: DomainEvent): Promise<void> {
      this.names.push(event.name);
      await this.hold;
    }
  }

  async function boot(t: TestContext, database: Database = db) {
    await db.sql`DELETE FROM platform.outbox WHERE processed_at IS NULL`;
    const core = new CoreWorkers();
    const inbox = new Inbox();
    core.on('probe.wake.*', inbox);
    const worker = new WatchedWorker(database, await emptyRegistry(), core);
    t.after(() => worker.onApplicationShutdown());
    return { worker, inbox };
  }

  const publish = (...names: readonly string[]) =>
    db.transaction((tx) =>
      new Outbox(tx).publish(names.map((name) => new DomainEvent(name, 1, SPACE, {}))),
    );

  /** 이 채널에 온 신호를 적는다. 일꾼에게도 같이 도착한 것을 확인할 때 쓴다 */
  async function heard(t: TestContext, channel: string): Promise<string[]> {
    const payloads: string[] = [];
    t.after(
      await db.listen(channel, (payload) => {
        payloads.push(payload);
      }),
    );
    return payloads;
  }

  test('커밋하면 주기를 기다리지 않고 신호로 처리한다', LIMIT, async (t) => {
    const { worker, inbox } = await boot(t);
    worker.start(HOUR);
    await until(() => worker.ticks > 0);

    await publish('probe.wake.saved');
    await until(() => inbox.names.length === 1);
    assert.deepEqual(inbox.names, ['probe.wake.saved']);
  });

  test('처리하는 중에 온 신호를 놓치지 않는다', LIMIT, async (t) => {
    const { worker, inbox } = await boot(t);
    const signals = await heard(t, Outbox.CHANNEL);
    let release = () => {};
    inbox.hold = new Promise((resolve) => {
      release = resolve;
    });
    worker.start(HOUR);
    await until(() => worker.ticks > 0);

    await publish('probe.wake.first');
    await until(() => inbox.names.length === 1);
    await publish('probe.wake.second');
    await until(() => signals.length === 2);
    assert.deepEqual(inbox.names, ['probe.wake.first'], '첫 바퀴가 아직 돌고 있다');

    release();
    await until(() => inbox.names.length === 2);
    assert.deepEqual(inbox.names, ['probe.wake.first', 'probe.wake.second']);
  });

  test('신호 한 번으로 51개를 모두 처리한다', LIMIT, async (t) => {
    const { worker, inbox } = await boot(t);
    worker.start(HOUR);
    await until(() => worker.ticks > 0);
    const before = worker.ticks;

    await publish(...Array.from({ length: 51 }, () => 'probe.wake.many'));
    await until(() => worker.ticks === before + 2);
    assert.equal(inbox.names.length, 51);
  });

  test('듣기에 실패해도 주기로 처리한다', LIMIT, async (t) => {
    const probe = new ProbeDatabase();
    probe.broken = true;
    t.after(() => probe.onApplicationShutdown());
    const { worker, inbox } = await boot(t, probe);
    await publish('probe.wake.saved');

    worker.start(20);
    await until(() => inbox.names.length === 1);
    assert.equal(probe.listens, 1);
  });

  test('되돌린 트랜잭션은 일꾼을 깨우지 않는다', LIMIT, async (t) => {
    const { worker, inbox } = await boot(t);
    worker.start(HOUR);
    await until(() => worker.ticks > 0);
    const before = worker.ticks;

    await assert.rejects(
      db.transaction(async (tx) => {
        await new Outbox(tx).publish([new DomainEvent('probe.wake.undone', 1, SPACE, {})]);
        throw new Error('되돌리기');
      }),
      /되돌리기/,
    );
    await sleep(200);
    assert.equal(worker.ticks, before);

    await publish('probe.wake.saved');
    await until(() => inbox.names.length === 1);
    assert.deepEqual(inbox.names, ['probe.wake.saved'], '듣고 있었다');
  });

  test('필수 주제에 받는 쪽이 없으면 듣기 전에 바로 실패한다', LIMIT, async (t) => {
    const probe = new ProbeDatabase();
    t.after(() => probe.onApplicationShutdown());
    const core = new CoreWorkers();
    core.expect('task.approval.granted');
    const worker = new OutboxWorker(probe, await emptyRegistry(), core);

    assert.throws(() => worker.start(), /task\.approval\.granted/);
    assert.equal(probe.listens, 0);
  });

  test('내려갈 때 듣기와 타이머를 멈추고 걸리지 않는다', LIMIT, async (t) => {
    const probe = new ProbeDatabase();
    t.after(() => probe.onApplicationShutdown());
    const { worker } = await boot(t, probe);
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const timersBefore = timers();
    worker.start(20);
    await until(() => worker.ticks > 1);

    // Nest는 같은 모듈의 훅을 함께 부른다: 듣기를 멈추는 동안 DB도 닫힌다
    await Promise.all([probe.onApplicationShutdown(), worker.onApplicationShutdown()]);
    assert.equal(probe.unlistens, 1);
    await until(() => timers() <= timersBefore); // 일꾼의 타이머가 남으면 프로세스가 끝나지 않는다

    await sleep(50); // 내려가기 전에 돌던 바퀴가 끝나기를 기다린다
    const ticks = worker.ticks;
    await publish('probe.wake.late');
    await sleep(200);
    assert.equal(worker.ticks, ticks);
  });

  test('듣기를 마치기 전에 내려가도 걸리지 않고 깨지 않는다', LIMIT, async (t) => {
    const probe = new ProbeDatabase();
    t.after(() => probe.onApplicationShutdown());
    const { worker } = await boot(t, probe);
    worker.start(HOUR);

    await worker.onApplicationShutdown();
    assert.equal(probe.unlistens, 1);
    assert.equal(worker.ticks, 0);
  });

  test('한 바퀴가 실패해도 다음 신호로 다시 돈다', LIMIT, async (t) => {
    const { worker, inbox } = await boot(t);
    worker.failNext = true;
    worker.start(HOUR);
    await until(() => worker.ticks > 0);

    await publish('probe.wake.saved');
    await until(() => inbox.names.length === 1);
  });

  test('연결이 끊기면 다시 듣고 한 번만 깨우며, 내려간 뒤에는 깨지 않는다', LIMIT, async (t) => {
    const probe = new ProbeDatabase();
    t.after(() => probe.onApplicationShutdown());
    const { worker, inbox } = await boot(t, probe);
    worker.start(HOUR);
    await until(() => worker.ticks > 0);
    const before = worker.ticks;

    const killed = await db.sql`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = current_database() AND query ILIKE 'listen%'`;
    assert.equal(killed.length, 1);
    await until(() => worker.ticks > before);
    await sleep(100);
    assert.equal(worker.ticks, before + 1);

    await publish('probe.wake.saved');
    await until(() => worker.ticks === before + 2);
    assert.deepEqual(inbox.names, ['probe.wake.saved']);

    // 다시 연결한 뒤에는 라이브러리의 unlisten이 듣기를 빼지 못한다. 그래도 일꾼은 깨지 않아야 한다
    await worker.onApplicationShutdown();
    const ticks = worker.ticks;
    await publish('probe.wake.late');
    await sleep(200);
    assert.equal(worker.ticks, ticks);
  });

  test('publish 한 번에 빈 신호 하나만 보내고, 변경 신호로는 깨지 않는다', LIMIT, async (t) => {
    const { worker } = await boot(t);
    const signals = await heard(t, Outbox.CHANNEL);
    const changes = await heard(t, ChangeSignal.CHANNEL);
    worker.start(HOUR);
    await until(() => worker.ticks > 0);

    await publish('probe.wake.one', 'probe.wake.two', 'probe.wake.three');
    await until(() => changes.length === 3 && signals.length === 1);
    assert.deepEqual(signals, ['']);

    await until(() => worker.ticks > 1);
    const before = worker.ticks;
    await db.transaction((tx) => ChangeSignal.send(tx, [new ChangeSignal(SPACE, 'log', 'x')]));
    await until(() => changes.length === 4);
    await sleep(100);
    assert.equal(worker.ticks, before);
  });
});
