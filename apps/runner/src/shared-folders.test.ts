import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { ConfigProblem, RunnerConfig } from './runner-config';
import { SharedFolders } from './shared-folders';

// 내 컴퓨터 러너가 나눠 주는 폴더: 설정 검사와 복사 규칙 (숨김 · .git · node_modules · 링크 빼기, 한도).

const root = mkdtempSync(join(tmpdir(), 'cairn-share-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** project/ 와 docs/ 두 폴더 */
function tree(): { project: string; docs: string } {
  const base = mkdtempSync(join(root, 'src-'));
  const project = join(base, 'project');
  const docs = join(base, 'docs');
  for (const dir of ['src', '.git', 'node_modules/pkg'])
    mkdirSync(join(project, dir), { recursive: true });
  mkdirSync(docs);
  writeFileSync(join(project, 'README.md'), '# 프로젝트');
  writeFileSync(join(project, 'src', 'main.ts'), 'export {};');
  writeFileSync(join(project, '.env'), 'SECRET=1');
  writeFileSync(join(project, '.git', 'config'), '[core]');
  writeFileSync(join(project, 'node_modules', 'pkg', 'index.js'), '');
  symlinkSync('/etc/hostname', join(project, 'link'));
  writeFileSync(join(docs, 'plan.md'), '계획');
  return { project, docs };
}

const env = { CAIRN_RUNNER_URL: 'https://blog.example', CAIRN_RUNNER_TOKEN: 't', HOME: '/home/me' };

describe('나눠 주는 폴더 (CAIRN_RUNNER_FOLDERS)', () => {
  test('쉼표로 여럿, 절대 경로의 있는 폴더만. 없으면 null', () => {
    const { project, docs } = tree();
    assert.equal(RunnerConfig.fromEnv(env).folders, null);
    const config = RunnerConfig.fromEnv({ ...env, CAIRN_RUNNER_FOLDERS: ` ${project} , ${docs} ` });
    assert.deepEqual(config.folders?.paths, [project, docs]);
    assert.deepEqual(config.withToken('x').folders?.paths, [project, docs], '토큰을 받은 뒤에도');
  });

  test('상대 경로 · 없는 폴더 · 숨김 폴더 · 홈 전체와 그 위 · 겹치는 이름 · 코드 러너 칸은 시작하지 않는다', () => {
    const { project } = tree();
    const other = join(mkdtempSync(join(root, 'dup-')), 'project');
    mkdirSync(other);
    const hidden = join(root, '.secret');
    mkdirSync(hidden, { recursive: true });
    const cases: [Record<string, string>, RegExp][] = [
      [{ CAIRN_RUNNER_FOLDERS: 'project' }, /절대 경로/],
      [{ CAIRN_RUNNER_FOLDERS: join(root, 'nope') }, /없어요/],
      [{ CAIRN_RUNNER_FOLDERS: hidden }, /숨김/],
      [{ CAIRN_RUNNER_FOLDERS: root, HOME: join(root, 'me') }, /홈 폴더 전체나 그 위/],
      [{ CAIRN_RUNNER_FOLDERS: join(root, 'me'), HOME: join(root, 'me') }, /홈 폴더 전체/],
      [{ CAIRN_RUNNER_FOLDERS: '/' }, /홈 폴더 전체나 그 위/],
      [{ CAIRN_RUNNER_FOLDERS: `${project},${other}` }, /이름이 겹쳐요: project/],
      [{ CAIRN_RUNNER_FOLDERS: project, CAIRN_SANDBOX: '1' }, /내 컴퓨터 러너에서만/],
    ];
    mkdirSync(join(root, 'me'), { recursive: true });
    for (const [more, message] of cases)
      assert.throws(
        () => RunnerConfig.fromEnv({ ...env, ...more }),
        (e: Error) => e instanceof ConfigProblem && message.test(e.message),
        JSON.stringify(more),
      );
  });

  test('일마다 작업 폴더로 복사한다. 숨김 · .git · node_modules · 링크는 빼고, 단락에 폴더와 파일 수를 적는다', async () => {
    const { project, docs } = tree();
    const into = mkdtempSync(join(root, 'work-'));
    const copy = await new SharedFolders([project, docs]).copyInto(into);
    assert.equal(readFileSync(join(into, 'project', 'README.md'), 'utf8'), '# 프로젝트');
    assert.ok(existsSync(join(into, 'project', 'src', 'main.ts')));
    assert.ok(existsSync(join(into, 'docs', 'plan.md')));
    for (const skipped of ['.env', '.git', 'node_modules', 'link'])
      assert.equal(existsSync(join(into, 'project', skipped)), false, skipped);
    assert.equal(copy.cut, false);
    assert.match(copy.part, /folders\/project \(파일 2개\)\n- folders\/docs \(파일 1개\)/);
    assert.match(copy.part, /읽기만, 복사본/);
    assert.doesNotMatch(copy.part, /일부만/);
  });

  test('한도(파일 수 · 크기)에 닿으면 거기까지만 복사하고 단락에 알린다', async () => {
    const { project, docs } = tree();
    const few = await new SharedFolders([project, docs], 1024, 2).copyInto(
      mkdtempSync(join(root, 'few-')),
    );
    assert.equal(few.cut, true);
    assert.match(few.part, /일부만 복사했습니다/);
    const big = join(docs, 'big.bin');
    writeFileSync(big, Buffer.alloc(2048));
    const into = mkdtempSync(join(root, 'small-'));
    const small = await new SharedFolders([docs], 1024, 100).copyInto(into);
    assert.equal(existsSync(join(into, 'docs', 'big.bin')), false, '한도보다 큰 파일');
    assert.ok(existsSync(join(into, 'docs', 'plan.md')));
    assert.equal(small.cut, true);
  });
});
