import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { RunnerAbility } from './runner-ability';
import { RunnerConfig } from './runner-config';

// 러너가 서버에 알리는 것: 일할 수 있는 AI, 웹 로그인을 돌릴 수 있는 CLI, 이 컴퓨터의 로그인.

let bin: string;

/** bin 폴더에 실행 파일을 하나 둔다 */
async function tool(name: string, mode = 0o755): Promise<string> {
  const path = join(bin, name);
  await writeFile(path, '#!/bin/sh\n');
  await chmod(path, mode);
  return path;
}

const config = (cli: string, codex: string, token: string | null = null) =>
  new RunnerConfig('http://localhost', 'device', token, cli, '/없는', null, codex);

before(async () => {
  bin = await mkdtemp(join(tmpdir(), 'ability-'));
});

after(async () => {
  await rm(bin, { recursive: true, force: true });
});

describe('러너가 할 수 있는 것', () => {
  test('설치된 CLI만 알린다. 일과 웹 로그인 모두 Claude · Codex', async () => {
    const claude = await tool('claude');
    const codex = await tool('codex');
    const path = `${bin}:${process.env.PATH}`;
    const ability = RunnerAbility.detect(config(claude, codex), { PATH: path });
    assert.deepEqual(ability.tools, ['claude', 'codex']);
    if (process.platform === 'linux') assert.deepEqual(ability.signinTools, ['claude', 'codex']);
    assert.deepEqual(ability.ownLogins, []);
  });

  test('경로가 없거나 실행할 수 없는 파일은 없는 것이다. PATH에서도 찾는다', async () => {
    await tool('codex');
    const plain = await tool('not-executable', 0o644);
    const path = `${bin}:${process.env.PATH}`;
    const ability = RunnerAbility.detect(config('/없는/claude', 'codex'), { PATH: path });
    assert.deepEqual(ability.tools, ['codex']);
    if (process.platform === 'linux') assert.deepEqual(ability.signinTools, ['codex']);
    assert.equal(RunnerAbility.installed(plain, ''), false);
    assert.equal(RunnerAbility.installed('codex', path), true);
    assert.equal(RunnerAbility.installed('codex', ''), false);
  });

  test('환경 변수의 Claude 토큰은 이 컴퓨터의 로그인이다', async () => {
    const claude = await tool('claude');
    const ability = RunnerAbility.detect(config(claude, '/없는/codex', 'env-token'), {
      PATH: process.env.PATH,
    });
    assert.deepEqual(ability.ownLogins, ['claude']);
    assert.deepEqual(ability.toArgs().own_logins, ['claude']);
    assert.match(ability.line, /일할 수 있는 AI: claude/);
  });

  test('코드 러너 칸: 칸 번호를 로그에 알리고 브라우저 작업은 받지 않는다. next_jobs에는 싣지 않는다', async () => {
    const claude = await tool('claude');
    const slot = new RunnerConfig(
      'http://localhost',
      null,
      null,
      claude,
      '/없는',
      '/run/cairn-code/pairing',
      '/없는/codex',
      'http://browser:9222',
      '1',
    );
    const ability = RunnerAbility.detect(slot, { PATH: process.env.PATH });
    assert.equal(ability.sandbox, true);
    assert.equal(ability.browser, false, '칸에는 브라우저 작업을 주지 않는다');
    assert.match(ability.line, /코드 러너 칸 1: 코드 작업만 받음/);
    assert.equal('sandbox' in ability.toArgs(), false, '칸인지는 서버가 기기로 정한다');
    assert.equal(RunnerAbility.detect(config(claude, '/없는/codex')).sandbox, false);
  });
});
