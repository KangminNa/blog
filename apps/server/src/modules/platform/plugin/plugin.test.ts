import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { ApiClient } from '../../../testing/api-client';
import { ArchiveQuery } from '../archive/archive.query';
import { ArchiveRestoreService } from '../archive/archive-restore.service';
import { OwnerActor, VisitorActor } from '../base/actor';
import { BlobStore } from '../base/blob-store';
import { Database } from '../base/database';
import { Forbidden, RuleViolation } from '../base/errors';
import { SealedSecret, SecretBox } from '../base/secret-box';
import { SecretRotation } from '../base/secret-rotation';
import { PluginRepository } from './plugin.repository';
import { PluginService } from './plugin.service';
import { PluginManifest } from './plugin-manifest';
import { PluginRegistry } from './plugin-registry';

// 플러그인 목록 파일 검사, 비밀값 암호화, DB에 저장하는 켜기·끄기·설정.

const db = new Database();
const archive = new ArchiveQuery(db);
const restore = new ArchiveRestoreService(db, archive, new BlobStore(db));
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
    assert.equal(m.setting('mode')?.problemWith('c'), '모드: a, b 중 하나로 넣어 주세요');
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
    const registry = await PluginRegistry.boot(root, db.sql, archive, box, restore);
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
    const first = await PluginRegistry.boot(root, db.sql, archive, box, restore);
    await new PluginService(db, first, box).enable(owner, 'test-grow');

    mkdirSync(join(root, 'test-grow', 'server'), { recursive: true });
    writeFileSync(join(root, 'test-grow', 'server', 'plugin.ts'), 'export default class {}');
    makePlugin(root, 'test-grow', {
      ...v1,
      version: '0.2.0',
      server: 'server/plugin.ts',
      uses: ['archive:read'],
    });
    const upgraded = await PluginRegistry.boot(root, db.sql, archive, box, restore);
    const m = upgraded.manifest('test-grow');
    assert.ok(m);
    assert.deepEqual(m.needsGrant(new Set(upgraded.state('test-grow')?.grantedUses)), [
      'archive:read',
    ]);
    assert.equal(upgraded.state('test-grow')?.isActiveFor(m), false);
  });
});

describe('PluginRegistry: 운영 이미지', () => {
  test('컴파일한 .js가 .ts 옆에 있으면 .js를 불러 서버와 같은 BasePlugin으로 등록한다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    const dir = makePlugin(root, 'test-compiled', {
      name: 'test-compiled',
      version: '0.1.0',
      cairn: '>=0.1',
      server: 'server/plugin.ts',
      uses: ['action:hello'],
    });
    mkdirSync(join(dir, 'server'));
    writeFileSync(join(dir, 'server', 'plugin.ts'), 'throw new Error("소스를 읽었어요");');
    writeFileSync(
      join(dir, 'server', 'plugin.js'),
      `const { BasePlugin } = require(${JSON.stringify(join(__dirname, '../../../plugin-api'))});
       class Compiled extends BasePlugin { register(cairn) { cairn.addAction('hello', {}); } }
       exports.default = Compiled;`,
    );
    const registry = await PluginRegistry.boot(root, db.sql, archive, box, restore);
    await new PluginService(db, registry, box).enable(owner, 'test-compiled');
    assert.equal(registry.problem('test-compiled'), null);
    assert.ok(registry.action('test-compiled', 'hello'));
  });
});

describe('서버 키 교체 (DB)', () => {
  const oldKey = SecretBox.newKey();
  const newKey = SecretBox.newKey();
  const oldBox = SecretBox.fromEnv({ CAIRN_SECRET_KEY: oldKey });
  const rotating = SecretBox.fromEnv({ CAIRN_SECRET_KEY: newKey, CAIRN_SECRET_KEY_OLD: oldKey });
  const finished = SecretBox.fromEnv({ CAIRN_SECRET_KEY: newKey });

  /** 설정 하나의 저장된 모습 */
  async function storedSetting(plugin: string, key: string) {
    const [row] = await db.sql`
      SELECT value, secret_ciphertext, secret_nonce FROM platform.plugin_settings
      WHERE plugin = ${plugin} AND key = ${key}`;
    assert.ok(row, `${plugin}.${key}가 저장돼 있어야 해요`);
    return row;
  }

  const sealedOf = async (plugin: string) => {
    const row = await storedSetting(plugin, 'token');
    return new SealedSecret(row.secret_ciphertext, row.secret_nonce);
  };

  /** plugins 폴더 하나와, 그 폴더를 읽는 서비스 */
  async function serviceFor(root: string, withBox: SecretBox): Promise<PluginService> {
    const registry = await PluginRegistry.boot(root, db.sql, archive, withBox, restore);
    return new PluginService(db, registry, withBox);
  }

  // 교체는 DB의 모든 플러그인을 보므로, 앞선 테스트가 다른 키로 남긴 값을 비운다
  beforeEach(async () => {
    await db.sql`DELETE FROM platform.plugins`;
  });

  test('켜진·꺼진·폴더가 없어진 플러그인의 비밀값을 모두 바꾸고, 두 번 돌려도 그대로다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    for (const name of ['test-on', 'test-off', 'test-gone'])
      makePlugin(root, name, sample(name), ['web/Box.tsx']);
    const before = await serviceFor(root, oldBox);
    await before.enable(owner, 'test-on');
    await before.set(owner, 'test-on', 'repoId', 'R_1');
    await before.set(owner, 'test-on', 'token', 'ghp_on');
    await before.set(owner, 'test-off', 'token', 'ghp_off');
    await before.set(owner, 'test-gone', 'token', 'ghp_gone');
    const original = await sealedOf('test-on');

    const later = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    for (const name of ['test-on', 'test-off'])
      makePlugin(later, name, sample(name), ['web/Box.tsx']);
    const service = await serviceFor(later, rotating);

    assert.equal(await service.resealSecrets(owner), 3);
    const first = await sealedOf('test-on');
    assert.notDeepEqual(first.ciphertext, original.ciphertext);
    assert.equal((await storedSetting('test-on', 'repoId')).value, 'R_1', '일반 값은 그대로');
    assert.equal(finished.open(first), 'ghp_on');
    assert.equal(finished.open(await sealedOf('test-off')), 'ghp_off');
    assert.equal(finished.open(await sealedOf('test-gone')), 'ghp_gone');
    await assert.rejects(service.resealSecrets(new VisitorActor()), Forbidden);

    assert.equal(await service.resealSecrets(owner), 0, '두 번째는 할 일이 없다');
    assert.deepEqual((await sealedOf('test-on')).ciphertext, first.ciphertext);

    // 옛 키를 지운 뒤에도 켜진 플러그인이 값을 읽고, 다시 돌리면 확인이 된다
    const afterwards = await serviceFor(later, finished);
    assert.equal(await afterwards.resealSecrets(owner), 0);
  });

  test('풀리지 않는 값이 하나라도 있으면 아무것도 바꾸지 않고, 그 값을 다시 넣으면 이어서 된다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    for (const name of ['test-a', 'test-b']) makePlugin(root, name, sample(name), ['web/Box.tsx']);
    await (await serviceFor(root, oldBox)).set(owner, 'test-a', 'token', 'ghp_a');
    const stranger = SecretBox.fromEnv({ CAIRN_SECRET_KEY: SecretBox.newKey() });
    await (await serviceFor(root, stranger)).set(owner, 'test-b', 'token', 'ghp_lost');
    const original = await sealedOf('test-a');

    const service = await serviceFor(root, rotating);
    await assert.rejects(service.resealSecrets(owner), /플러그인 test-b의 token: .*풀 수 없어요/);
    assert.deepEqual((await sealedOf('test-a')).ciphertext, original.ciphertext, '되돌렸다');
    assert.equal(oldBox.open(await sealedOf('test-a')), 'ghp_a');

    await service.set(owner, 'test-b', 'token', 'ghp_new');
    assert.equal(await service.resealSecrets(owner), 1);
    assert.equal(finished.open(await sealedOf('test-a')), 'ghp_a');
    assert.equal(finished.open(await sealedOf('test-b')), 'ghp_new');
  });

  test('다른 곳에서 값을 바꾸는 동안 돌리면 끝나기를 기다려, 새 값을 옛 값으로 덮지 않는다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-plugins-'));
    const dir = makePlugin(root, 'test-race', sample('test-race'), ['web/Box.tsx']);
    await (await serviceFor(root, oldBox)).set(owner, 'test-race', 'token', 'ghp_before');
    const service = await serviceFor(root, rotating);
    const token = PluginManifest.read(dir).setting('token');
    assert.ok(token);

    // 값을 바꾸는 트랜잭션 안에서 교체를 시작한다. 잠금이 없으면 교체가 바뀌기 전의 값을 읽어 커밋 뒤에 덮어쓴다
    const [rotation] = await db.transaction(async (tx) => {
      const plugins = new PluginRepository(tx);
      const state = await plugins.lock('test-race');
      assert.ok(state);
      const started = service.resealSecrets(owner);
      await new Promise((done) => setTimeout(done, 100));
      state.set(token, 'ghp_after', rotating);
      await plugins.save(state, 'owner:u');
      return [started];
    });

    assert.equal(await rotation, 0, '새 값은 이미 지금 키로 잠겨 있다');
    assert.equal(finished.open(await sealedOf('test-race')), 'ghp_after');
  });

  test('서버가 뜨면 플러그인 설정이 SecretRotation에 등록돼 있다', async () => {
    const api = await ApiClient.start();
    try {
      const counts = await api.service(SecretRotation).run(owner);
      assert.equal(counts.get('플러그인 설정'), 0);
    } finally {
      await api.close();
    }
  });
});
