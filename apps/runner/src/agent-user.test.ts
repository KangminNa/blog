import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { AgentUser } from './agent-user';

// AI를 돌릴 사용자. 다른 사용자로 바꾸는 것은 root가 있어야 해서 Docker 시험(docs/코드작업.md 8장)에서 보고,
// 여기서는 모양 읽기와 self(시험용)의 실행 · 시간 초과 · 그만두기 · 읽기를 본다.

let dir: string;
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
const self = AgentUser.parse('self') as AgentUser;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-user-'));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AI를 돌릴 사용자', () => {
  test('"uid:gid"나 self만 읽는다', () => {
    const agent = AgentUser.parse('1001:1001');
    assert.equal(agent?.uid, 1001);
    assert.deepEqual(agent?.spawnOptions(), { uid: 1001, gid: 1001 });
    assert.equal(self.isSelf, true);
    assert.deepEqual(self.spawnOptions(), {});
    for (const bad of ['', 'agent', '1001', '1001:', ':1001', '-1:1', '1001:1001:1', 'self ']) {
      if (bad === 'self ') assert.equal(AgentUser.parse(bad)?.isSelf, true, '앞뒤 공백은 뗀다');
      else assert.equal(AgentUser.parse(bad), null, bad);
    }
  });

  test('명령을 돌려 끝난 모습과 출력의 끝부분을 준다. stdout을 따로 모을 수 있다', async () => {
    const ok = await self.run('echo 안녕; echo 오류 >&2', { cwd: dir, env, timeoutMs: 10_000 });
    assert.equal(ok.ok, true);
    assert.equal(ok.how, '통과');
    assert.match(ok.tail, /안녕/);
    assert.match(ok.tail, /오류/);

    const failed = await self.run('echo 망함 >&2; exit 3', { cwd: dir, env, timeoutMs: 10_000 });
    assert.equal(failed.ok, false);
    assert.equal(failed.how, '코드 3');

    const kept = await self.run('printf abc; echo 끝 >&2', {
      cwd: dir,
      env,
      timeoutMs: 10_000,
      stdoutMax: 10,
    });
    assert.equal(kept.stdout?.toString(), 'abc');
    assert.equal(kept.tail, '끝', 'stdout을 모으면 끝부분에는 stderr만');
    const over = await self.run('printf 0123456789AB', {
      cwd: dir,
      env,
      timeoutMs: 10_000,
      stdoutMax: 10,
    });
    assert.equal(over.stdout, null, '한도를 넘으면 null');
  });

  test('시간이 다 되거나 그만두게 하면 손자까지 끈다', async () => {
    const started = Date.now();
    const slow = await self.run('sleep 30 & sleep 30', { cwd: dir, env, timeoutMs: 300 });
    assert.equal(slow.timedOut, true);
    assert.equal(slow.how, '시간 초과');
    assert.ok(Date.now() - started < 5_000);

    const stop = new AbortController();
    setTimeout(() => stop.abort(), 200);
    const cut = await self.run('sleep 30', {
      cwd: dir,
      env,
      timeoutMs: 30_000,
      signal: stop.signal,
    });
    assert.equal(cut.aborted, true);

    const missing = await self.exec('/없는/실행파일', [], { cwd: dir, env, timeoutMs: 5_000 });
    assert.notEqual(missing.spawnError, null);
    assert.match(missing.how, /실행하지 못함/);
  });

  test('파일을 한도까지만 읽고, 없거나 넘으면 null', async () => {
    const file = join(dir, 'auth.json');
    await writeFile(file, '{"a":1}');
    assert.equal(await self.readFile(file, 100), '{"a":1}');
    assert.equal(await self.readFile(file, 3), null);
    assert.equal(await self.readFile(join(dir, '없음'), 100), null);
  });

  test('자리를 지운다. 안의 링크는 따라가지 않는다', async () => {
    const keep = join(dir, 'keep.txt');
    await writeFile(keep, '남아야 함');
    const room = await mkdtemp(join(dir, 'room-'));
    await symlink(keep, join(room, 'link'));
    await self.remove(room);
    assert.equal(await self.readFile(keep, 100), '남아야 함');
    assert.equal(await self.readFile(join(room, 'link'), 100), null);
  });
});
