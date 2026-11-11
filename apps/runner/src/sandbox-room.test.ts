import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { AgentUser } from './agent-user';
import { SandboxRoom } from './sandbox-room';

// 칸의 일(코드 · 만들기) 하나의 자리. agent를 다른 사용자로 바꾸는 것은 Docker 시험에서 보고, 여기서는 self로 자리의 모양을 본다.

const TASK = '0190f5a2-0000-7000-8000-0000000000b1';
const self = AgentUser.parse('self') as AgentUser;
let base: string;

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'sandbox-room-'));
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('칸의 작업 자리', () => {
  test('러너만 여는 곳(깨끗한 clone)과 agent의 곳(사본 · 홈 · 임시)을 나눈다', async () => {
    const room = await SandboxRoom.open(base, TASK, self);
    assert.equal((await stat(join(room.dir, 'runner'))).mode & 0o777, 0o700, '러너만');
    assert.equal((await stat(room.gitHome)).mode & 0o777, 0o700);
    await mkdir(room.cleanDir);
    await writeFile(join(room.cleanDir, 'a.txt'), '사본');
    await room.handOver();
    assert.equal(await readFile(join(room.workDir, 'a.txt'), 'utf8'), '사본');
    assert.ok(existsSync(room.homeDir) && existsSync(room.tmpDir));
    const env = room.env();
    assert.equal(env.HOME, room.homeDir);
    assert.equal(env.TMPDIR, room.tmpDir);
    assert.equal(
      Object.keys(env).some((k) => k.startsWith('CAIRN_')),
      false,
      '러너의 설정은 넘기지 않는다',
    );
    await room.close();
    assert.deepEqual(await readdir(base), []);
  });

  test('남은 자리가 있으면 새로 열 때와 러너가 시작할 때 치운다', async () => {
    const left = await SandboxRoom.open(base, TASK, self);
    await writeFile(join(left.dir, 'leftover'), 'x');
    const again = await SandboxRoom.open(base, TASK, self);
    assert.equal(existsSync(join(again.dir, 'leftover')), false);
    await mkdir(join(base, '0190f5a2-0000-7000-8000-0000000000b2'));
    await mkdir(join(base, 'not-a-room'));
    assert.equal(await SandboxRoom.sweep(base, self), 2);
    assert.deepEqual(
      await readdir(base),
      ['not-a-room'],
      '작업 자리 모양이 아닌 것은 건드리지 않는다',
    );
  });

  test('만들기 작업은 빈 작업 폴더와 받아 둔 재료(inputs/)를 넘기고, 닫을 때 함께 지운다', async () => {
    const room = await SandboxRoom.open(base, TASK, self);
    const inputs = await room.openInputs();
    assert.equal((await stat(inputs)).mode & 0o777, 0o700, '받는 동안은 러너만');
    await writeFile(join(inputs, '표지.png'), '재료');
    await room.handOver(false);
    assert.deepEqual(await readdir(room.workDir), [], '저장소 사본이 없다');
    assert.equal(await readFile(join(room.inputsDir, '표지.png'), 'utf8'), '재료');
    await room.close();
    assert.equal(existsSync(room.dir), false);
  });

  test('작업 id 모양이 아니면 자리를 만들지 않는다', async () => {
    await assert.rejects(SandboxRoom.open(base, '../x', self));
  });
});
