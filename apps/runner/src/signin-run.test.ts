import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { SigninRun } from './signin-run';

// 러너가 갑자기 죽어 남은 로그인 폴더 치우기. 지금 로그인 중인 폴더는 새것이라 남긴다.

describe('남은 로그인 폴더 치우기', () => {
  test('10분이 지난 폴더만 지운다. 이름이 다른 폴더는 건드리지 않는다', async () => {
    const old = await mkdtemp(join(tmpdir(), 'cairn-signin-'));
    const fresh = await mkdtemp(join(tmpdir(), 'cairn-signin-'));
    const other = await mkdtemp(join(tmpdir(), 'not-cairn-'));
    await writeFile(join(old, 'auth.json'), '{}');
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    await utimes(old, hourAgo, hourAgo);
    await utimes(other, hourAgo, hourAgo);
    try {
      assert.ok((await SigninRun.sweep()) >= 1);
      assert.equal(existsSync(old), false);
      assert.equal(existsSync(fresh), true, '로그인 중일 수 있다');
      assert.equal(existsSync(other), true);
    } finally {
      for (const dir of [old, fresh, other]) await rm(dir, { recursive: true, force: true });
    }
  });
});
