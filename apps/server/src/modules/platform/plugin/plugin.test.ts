import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { ArchiveQuery } from '../archive/archive.query';
import { OwnerActor, VisitorActor } from '../base/actor';
import { Database } from '../base/database';
import { Forbidden, RuleViolation } from '../base/errors';
import { SecretBox } from '../base/secret-box';
import { PluginService } from './plugin.service';
import { PluginManifest } from './plugin-manifest';
import { PluginRegistry } from './plugin-registry';

// 플러그인 목록 파일 검사, 비밀값 암호화, DB에 저장하는 켜기·끄기·설정.

const db = new Database();
const archive = new ArchiveQuery(db);
const box = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
const owner = new OwnerActor('s', 'u');
after(async () => {
  await db.sql`DELETE FROM platform.plugins WHERE name LIKE 'test-%'`;
  await db.onApplicationShutdown();
});

function makePlugin(
  root: string,
  name: string,
  manifest: object,
  files: readonly string[] = [],
): string {
  const dir = join(root, name);
  mkdirSync(join(dir, 'web'), { recursive: true });
  writeFileSync(join(dir, 'cairn-plugin.json'), JSON.stringify(manifest));
  for (const f of files)
    writeFileSync(join(dir, f), 'export default function X() { return null; }');
  return dir;
}

const sample = (name: string) => ({
  name,
  version: '0.1.0',
  cairn: '>=0.1',
  settings: {
    repoId: { label: '저장소 ID', type: 'text', required: true, public: true },
    token: { label: '토큰', type: 'secret', required: true },
    mode: { label: '모드', type: 'select', options: ['a', 'b'], default: 'a' },
  },
  web: { 'post.after': 'web/Box.tsx' },
});

describe('PluginManifest', () => {
  test('올바른 목록 파일을 읽는다', () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    const m = PluginManifest.read(makePlugin(root, 'test-ok', sample('test-ok'), ['web/Box.tsx']));
    assert.deepEqual([...m.webSlots.keys()], ['post.after']);
    assert.equal(m.setting('token')?.isSecret, true);
    assert.equal(m.setting('mode')?.problemWith('c'), '모드은(는) a, b 중 하나예요');
  });

  test('틀린 곳을 모두 모아 알린다', () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    const bad = {
      name: 'Bad_Name',
      version: '1',
      cairn: '>=9.0',
      settings: {
        pick: { label: '고르기', type: 'select' },
        key: { label: '키', type: 'secret', public: true },
      },
      web: { 'graph.unknown': 'web/None.tsx' },
    };
    assert.throws(
      () => PluginManifest.read(makePlugin(root, 'bad', bad)),
      (e: Error) =>
        [
          'name',
          'version',
          'cairn',
          'options가 없어요',
          '비밀 설정 "key"는 공개할 수 없어요',
          '모르는 화면 자리',
        ].every((w) => e.message.includes(w)),
    );
  });
});

describe('SecretBox', () => {
  test('암호화한 값은 같은 키로만 풀린다', () => {
    const sealed = box.seal('ghp_token');
    assert.notEqual(sealed.ciphertext.toString('utf8'), 'ghp_token');
    assert.equal(box.open(sealed), 'ghp_token');
    const other = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
    assert.throws(() => other.open(sealed), /서버 키/);
    assert.throws(() => SecretBox.fromEnv({}).seal('x'), /서버 키\(CAIRN_SECRET_KEY\)가 없어/);
  });
});

describe('PluginService (DB)', () => {
  test('켜기·설정·끄기가 DB에 남고, 비밀값은 암호화돼 저장된다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    makePlugin(root, 'test-giscus', sample('test-giscus'), ['web/Box.tsx']);
    const registry = await PluginRegistry.boot(root, db.sql, archive, box);
    const plugins = new PluginService(db, registry, box);

    await assert.rejects(plugins.enable(new VisitorActor(), 'test-giscus'), Forbidden);
    await plugins.enable(owner, 'test-giscus');
    await plugins.set(owner, 'test-giscus', 'repoId', 'R_1');
    await plugins.set(owner, 'test-giscus', 'token', 'ghp_secret');
    await assert.rejects(plugins.set(owner, 'test-giscus', 'mode', 'zzz'), RuleViolation);

    const [row] = await db.sql`
      SELECT value, secret_ciphertext FROM platform.plugin_settings WHERE plugin = 'test-giscus' AND key = 'token'`;
    assert.equal(row?.value, null);
    assert.equal(Buffer.from(row?.secret_ciphertext).includes(Buffer.from('ghp_secret')), false);

    const m = registry.manifest('test-giscus');
    const state = registry.state('test-giscus');
    assert.ok(m && state);
    assert.equal(state.isActiveFor(m), true);
    assert.deepEqual(Object.fromEntries(state.publicValues(m)), { repoId: 'R_1' });
    assert.equal(state.resolve(m, box).get('token'), 'ghp_secret');
    assert.equal(state.resolve(m, box).get('mode'), 'a', '비어 있으면 기본값');

    await plugins.disable(owner, 'test-giscus');
    assert.equal(registry.state('test-giscus')?.isActiveFor(m), false);
  });

  test('새 버전이 확장 지점을 더 쓰면 다시 켤 때까지 동작하지 않는다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    const v1 = { name: 'test-grow', version: '0.1.0', cairn: '>=0.1' };
    makePlugin(root, 'test-grow', v1);
    const first = await PluginRegistry.boot(root, db.sql, archive, box);
    await new PluginService(db, first, box).enable(owner, 'test-grow');

    mkdirSync(join(root, 'test-grow', 'server'), { recursive: true });
    writeFileSync(join(root, 'test-grow', 'server', 'plugin.ts'), 'export default class {}');
    makePlugin(root, 'test-grow', {
      ...v1,
      version: '0.2.0',
      server: 'server/plugin.ts',
      uses: ['archive:read'],
    });
    const upgraded = await PluginRegistry.boot(root, db.sql, archive, box);
    const m = upgraded.manifest('test-grow');
    assert.ok(m);
    assert.deepEqual(m.needsGrant(new Set(upgraded.state('test-grow')?.grantedUses)), [
      'archive:read',
    ]);
    assert.equal(upgraded.state('test-grow')?.isActiveFor(m), false);
  });
});
