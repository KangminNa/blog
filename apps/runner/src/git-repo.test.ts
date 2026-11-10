import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { CodeSpec } from './code-spec';
import { GitRepo, PatchRejected, RepoRefused, RepoUnreachable } from './git-repo';
import { GitServer } from './testing/git-server';

// 러너의 깨끗한 clone: 받기 · AI의 patch 옮기기 · 커밋 · 올리기. 시험용 git 서버(http-backend)에 붙는다.

const TASK = '0190f5a2-0000-7000-8000-0000000000a1';
let server: GitServer;
let url: string;
let dir: string;

const specFor = (repoUrl: string, base = 'main') =>
  CodeSpec.from(TASK, { repo: { url: repoUrl, base }, paths: ['src'] });

/** git을 따로 돌린다 (동기로 부르면 같은 프로세스의 시험용 서버가 답하지 못한다) */
const git = promisify(execFile);

/** AI의 자리에서 agent가 하는 것과 같게: 사본에서 고치고 기준과의 차이를 patch로 */
async function patchOf(change: (work: string) => Promise<void>): Promise<string> {
  const work = await mkdtemp(join(dir, 'ai-'));
  await git('git', ['clone', '-q', url, work]);
  await change(work);
  await git('git', ['-C', work, 'add', '-A']);
  const { stdout: patch } = await git(
    'git',
    ['-C', work, 'diff', '--cached', '--binary', '--no-renames', 'HEAD'],
    { encoding: 'buffer' },
  );
  const file = join(dir, `${Math.random()}.patch`);
  await writeFile(file, patch);
  return file;
}

before(async () => {
  server = await GitServer.start();
  url = server.create('app', { 'src/a.ts': 'export const a = 1;\n', 'README.md': '# app\n' });
  dir = await mkdtemp(join(tmpdir(), 'git-repo-'));
});

after(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

describe('러너의 깨끗한 clone', () => {
  test('받고, patch를 옮기고, 커밋 하나로 cairn/<작업>에 올린다', async () => {
    const repo = await GitRepo.clone(specFor(url), join(dir, 'clean-1'), dir, null);
    assert.equal(repo.baseSha, server.head('app', 'main'));
    const patch = await patchOf(async (work) => {
      await writeFile(join(work, 'src/a.ts'), 'export const a = 2;\n');
      await writeFile(join(work, 'src/b.bin'), Buffer.from([0, 1, 2, 255]));
    });
    const files = await repo.apply(patch, false);
    assert.deepEqual([...files].sort(), ['src/a.ts', 'src/b.bin']);
    const head = await repo.commit('cairn: 고침\n\n요약', '코드 담당 (Cairn)');
    await repo.push(`cairn/${TASK}`, null);
    assert.equal(server.head('app', `cairn/${TASK}`), head);
    assert.equal(server.show('app', `cairn/${TASK}`, 'src/a.ts'), 'export const a = 2;\n');
    assert.equal(server.head('app', 'main'), repo.baseSha, '기준 브랜치는 그대로');
  });

  test('빈 patch는 바뀐 파일이 없다', async () => {
    const repo = await GitRepo.clone(specFor(url), join(dir, 'clean-2'), dir, null);
    assert.deepEqual(await repo.apply('/없음', true), []);
  });

  test('저장소 밖 · .git 안 · 링크 너머로 가는 patch는 옮기지 않는다', async () => {
    const evil = [
      // 저장소 밖
      'diff --git a/../escape.txt b/../escape.txt\nnew file mode 100644\n--- /dev/null\n+++ b/../escape.txt\n@@ -0,0 +1 @@\n+x\n',
      // .git 안 (훅 심기)
      'diff --git a/.git/hooks/post-commit b/.git/hooks/post-commit\nnew file mode 100755\n--- /dev/null\n+++ b/.git/hooks/post-commit\n@@ -0,0 +1 @@\n+touch /tmp/pwned\n',
      // 링크를 만들고 그 너머에 쓰기
      'diff --git a/src/link b/src/link\nnew file mode 120000\n--- /dev/null\n+++ b/src/link\n@@ -0,0 +1 @@\n+/tmp\n\\ No newline at end of file\ndiff --git a/src/link/owned.txt b/src/link/owned.txt\nnew file mode 100644\n--- /dev/null\n+++ b/src/link/owned.txt\n@@ -0,0 +1 @@\n+x\n',
    ];
    for (const [i, text] of evil.entries()) {
      const repo = await GitRepo.clone(specFor(url), join(dir, `clean-evil-${i}`), dir, null);
      const file = join(dir, `evil-${i}.patch`);
      await writeFile(file, text);
      await assert.rejects(repo.apply(file, false), PatchRejected, `patch ${i}`);
    }
  });

  test('cairn/ 아래가 아닌 브랜치에는 올리지 않는다', async () => {
    const repo = await GitRepo.clone(specFor(url), join(dir, 'clean-3'), dir, null);
    await assert.rejects(repo.push('main', null), RepoRefused);
    await assert.rejects(repo.push('cairn/../main', null), RepoRefused);
  });

  test('없는 저장소 · 브랜치는 거절(실패), 닿지 못하면 닿지 못함(기다림)', async () => {
    await assert.rejects(
      GitRepo.clone(specFor(`${server.baseUrl}/없음.git`), join(dir, 'x1'), dir, null),
      RepoRefused,
    );
    await assert.rejects(
      GitRepo.clone(specFor(url, 'no-such-branch'), join(dir, 'x2'), dir, null),
      RepoRefused,
    );
    await assert.rejects(
      GitRepo.clone(specFor('http://127.0.0.1:1/app.git'), join(dir, 'x3'), dir, null),
      RepoUnreachable,
    );
  });
});
