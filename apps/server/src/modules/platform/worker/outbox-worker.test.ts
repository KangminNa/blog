import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { ArchiveQuery } from '../archive/archive.query';
import { Database } from '../base/database';
import { SecretBox } from '../base/secret-box';
import { PluginRegistry } from '../plugin/plugin-registry';
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
    const worker = new OutboxWorker(db, registry);
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
    const worker = new OutboxWorker(db, registry);
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
