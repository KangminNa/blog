import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { promisify } from 'node:util';
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

describe('이어서 고치기: 최신 기준 위에 앞 PR을 다시 얹기 (코드 작업 5단계)', () => {
  const BRANCH = `cairn/${TASK}`;
  let n = 0;

  /** 저장소 하나를 만들고 첫 실행처럼 src/a.ts를 바꿔 브랜치에 올린다 */
  async function firstRun(): Promise<{ name: string; url: string; head: string }> {
    const name = `replay-${++n}`;
    const repoUrl = server.create(name, { 'src/a.ts': 'a1\n', 'src/b.ts': 'b1\n' });
    const repo = await GitRepo.clone(specFor(repoUrl), join(dir, `${name}-first`), dir, null);
    const work = await mkdtemp(join(dir, 'ai-'));
    await git('git', ['clone', '-q', repoUrl, work]);
    await writeFile(join(work, 'src/a.ts'), 'a-pr\n');
    await git('git', ['-C', work, 'add', '-A']);
    const { stdout } = await git('git', ['-C', work, 'diff', '--cached', '--binary', 'HEAD'], {
      encoding: 'buffer',
    });
    const patch = join(dir, `${name}.patch`);
    await writeFile(patch, stdout);
    await repo.apply(patch, false);
    const head = await repo.commit('cairn: 처음', '에이전트');
    await repo.push(BRANCH, null);
    return { name, url: repoUrl, head };
  }

  const read = (repo: GitRepo, path: string) => readFile(join(repo.dir, path), 'utf8');

  test('충돌이 없으면 앞 변경이 최신 기준의 작업 트리에 얹히고, restore로 기준에 돌아간다', async () => {
    const first = await firstRun();
    server.commit(first.name, 'main', { 'src/b.ts': 'b-main\n' });
    const repo = await GitRepo.clone(specFor(first.url), join(dir, `${first.name}-2`), dir, null);
    assert.equal(repo.baseSha, server.head(first.name, 'main'));
    const replayed = await repo.replay(BRANCH, join(dir, `${first.name}-r.patch`), null);
    assert.equal(replayed?.head, first.head);
    assert.deepEqual(replayed?.conflicts, []);
    assert.equal(await read(repo, 'src/a.ts'), 'a-pr\n');
    assert.equal(await read(repo, 'src/b.ts'), 'b-main\n');
    await repo.restore();
    assert.equal(await read(repo, 'src/a.ts'), 'a1\n');
    const { stdout } = await git('git', ['-C', repo.dir, 'status', '--porcelain']);
    assert.equal(stdout, '');
  });

  test('기준이 같은 줄을 바꿨으면 충돌 표시를 남기고 그 파일을 알려 준다. 표시가 남은 변경은 찾아낸다', async () => {
    const first = await firstRun();
    server.commit(first.name, 'main', { 'src/a.ts': 'a-main\n' });
    const repo = await GitRepo.clone(specFor(first.url), join(dir, `${first.name}-2`), dir, null);
    const replayed = await repo.replay(BRANCH, join(dir, `${first.name}-r.patch`), null);
    assert.deepEqual(replayed?.conflicts, ['src/a.ts']);
    assert.match(await read(repo, 'src/a.ts'), /^<<<<<<< [\s\S]*a-main[\s\S]*a-pr[\s\S]*>>>>>>> /);
    await repo.restore();

    const left = await patchOfFrom(first.url, async (work) => {
      await writeFile(
        join(work, 'src/a.ts'),
        '<<<<<<< ours\na-main\n=======\na-pr\n>>>>>>> theirs\n',
      );
    });
    await repo.apply(left, false);
    assert.deepEqual(await repo.conflictMarkers(), ['src/a.ts']);
  });

  test('푼 변경에는 충돌 표시가 없다', async () => {
    const first = await firstRun();
    server.commit(first.name, 'main', { 'src/a.ts': 'a-main\n' });
    const repo = await GitRepo.clone(specFor(first.url), join(dir, `${first.name}-2`), dir, null);
    const solved = await patchOfFrom(first.url, async (work) => {
      await writeFile(join(work, 'src/a.ts'), 'a-main\na-pr\n');
    });
    await repo.apply(solved, false);
    assert.deepEqual(await repo.conflictMarkers(), []);
  });

  test('브랜치가 없으면(주인이 지움) null', async () => {
    const first = await firstRun();
    const repo = await GitRepo.clone(specFor(first.url), join(dir, `${first.name}-2`), dir, null);
    const other = `cairn/${TASK.replace('a1', 'b2')}`;
    assert.equal(await repo.replay(other, join(dir, `${first.name}-r.patch`), null), null);
  });

  test('그사이 브랜치가 바뀌었으면 덮지 않는다 (force-with-lease), 앞 끝 그대로면 덮는다', async () => {
    const first = await firstRun();
    const repo = await GitRepo.clone(specFor(first.url), join(dir, `${first.name}-2`), dir, null);
    const replayed = await repo.replay(BRANCH, join(dir, `${first.name}-r.patch`), null);
    await repo.restore();
    const change = await patchOfFrom(first.url, async (work) => {
      await writeFile(join(work, 'src/a.ts'), 'a-pr\na-more\n');
    });
    await repo.apply(change, false);
    await repo.commit('cairn: 다시', '에이전트');
    server.commit(first.name, BRANCH, { 'src/c.ts': '누가 올림\n' });
    await assert.rejects(repo.push(BRANCH, null, undefined, replayed?.head ?? null), RepoRefused);
    assert.notEqual(server.show(first.name, BRANCH, 'src/c.ts'), null, '남이 올린 것은 그대로');
  });
});

/** 저장소의 main에서 agent처럼 고친 patch (url을 정해서) */
async function patchOfFrom(
  repoUrl: string,
  change: (work: string) => Promise<void>,
): Promise<string> {
  const work = await mkdtemp(join(dir, 'ai-'));
  await git('git', ['clone', '-q', repoUrl, work]);
  await change(work);
  await git('git', ['-C', work, 'add', '-A']);
  const { stdout } = await git('git', ['-C', work, 'diff', '--cached', '--binary', 'HEAD'], {
    encoding: 'buffer',
  });
  const file = join(dir, `${Math.random()}.patch`);
  await writeFile(file, stdout);
  return file;
}
