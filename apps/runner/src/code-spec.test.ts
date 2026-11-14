import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CodeSpec, CodeSpecProblem } from './code-spec';
import { REPO_PROMPTS } from './testing/repo-prompts';

// 코드 작업의 저장소 정보: 모양 검사, 고쳐도 되는 경로, AI에게 주는 단락.

const TASK = '0190f5a2-0000-7000-8000-000000000001';
const good = {
  repo: { url: 'https://github.com/me/app', base: 'main' },
  paths: ['apps/server/src/modules/blog/', 'README.md'],
  setup: 'pnpm install --frozen-lockfile',
  checks: ['pnpm check', 'pnpm test'],
};
const spec = (changes: Record<string, unknown> = {}) =>
  CodeSpec.from(TASK, { ...good, ...changes });
const refused = (changes: Record<string, unknown>, label: string) =>
  assert.throws(() => spec(changes), CodeSpecProblem, label);

describe('코드 작업의 저장소 정보', () => {
  test('맞는 모양을 읽는다. 경로 끝의 /는 떼고, 브랜치는 cairn/<작업>', () => {
    const s = spec();
    assert.equal(s.repoUrl, 'https://github.com/me/app');
    assert.equal(s.base, 'main');
    assert.deepEqual(s.paths, ['apps/server/src/modules/blog', 'README.md']);
    assert.deepEqual(s.checks, ['pnpm check', 'pnpm test']);
    assert.equal(s.branch, `cairn/${TASK}`);
    assert.equal(spec({ setup: null, checks: undefined }).setup, null);
    assert.equal(spec({ setup: '' }).setup, null, '빈 setup은 없는 것');
    assert.deepEqual(spec({ checks: undefined }).checks, []);
  });

  test('repo.id가 있으면 code-github가 맡긴 일 (PR · 결재까지), 없으면 브랜치까지. 모양이 틀리면 거절', () => {
    assert.equal(spec().repoId, null);
    const id = '0190f5a2-0000-7000-8000-0000000000ab';
    assert.equal(spec({ repo: { ...good.repo, id } }).repoId, id);
    refused({ repo: { ...good.repo, id: 'not-a-uuid' } }, '틀린 id');
    refused({ repo: { ...good.repo, id: 7 } }, '숫자 id');
  });

  test('고쳐도 되는 곳: 폴더 아래 전부와 파일 하나. 이름이 비슷한 이웃은 아니다', () => {
    const s = spec();
    assert.equal(s.allows('apps/server/src/modules/blog/post/post.ts'), true);
    assert.equal(s.allows('README.md'), true);
    assert.equal(
      s.allows('apps/server/src/modules/blogger/x.ts'),
      false,
      '접두어가 아니라 폴더 단위',
    );
    assert.equal(s.allows('README.md.bak'), false);
    assert.equal(s.allows('apps/server/src/modules/vault/a.ts'), false);
    assert.deepEqual(s.outside(['README.md', 'package.json', 'apps/web/x.ts']), [
      'package.json',
      'apps/web/x.ts',
    ]);
    const whole = spec({ paths: ['.'] });
    assert.equal(whole.allows('anything/at/all.ts'), true);
  });

  test('.github/workflows는 paths와 상관없이 늘 막는다 (저장소 전체여도, 대소문자가 달라도)', () => {
    const whole = spec({ paths: ['.', '.github'] });
    assert.equal(whole.allows('.github/workflows/ci.yml'), false);
    assert.equal(whole.allows('.GitHub/Workflows/ci.yml'), false);
    assert.equal(whole.allows('.github/CODEOWNERS'), true);
  });

  test('주소: https만 (이 컴퓨터만 http도). 자격 · ? · #는 받지 않는다', () => {
    assert.equal(
      spec({ repo: { url: 'http://127.0.0.1:9000/app.git', base: 'main' } }).repoUrl,
      'http://127.0.0.1:9000/app.git',
    );
    for (const url of [
      'http://github.com/me/app',
      'file:///etc',
      'ssh://git@github.com/me/app',
      'ext::sh -c touch% /tmp/x',
      'https://user:token@github.com/me/app',
      'https://github.com/me/app?x=1',
      'not a url',
      '',
    ])
      refused({ repo: { url, base: 'main' } }, url);
  });

  test('기준 브랜치: 옵션처럼 보이거나 git이 막는 이름은 안 된다', () => {
    assert.equal(spec({ repo: { url: good.repo.url, base: 'release/1.2' } }).base, 'release/1.2');
    for (const base of [
      '-x',
      '--upload-pack=evil',
      'a..b',
      'a/.b',
      'a//b',
      'x.lock',
      'a b',
      'a@{1}',
      '',
    ])
      refused({ repo: { url: good.repo.url, base } }, base);
  });

  test('경로: 위로 가기 · .git · 절대 경로 · 빈 것 · 너무 많은 것은 안 된다', () => {
    for (const paths of [
      [],
      ['../x'],
      ['a/../../x'],
      ['/etc'],
      ['.git/hooks'],
      ['a/.GIT/x'],
      ['a\\b'],
      [''],
      ['./a'],
      [1],
      Array.from({ length: 21 }, (_, i) => `p${i}`),
    ])
      refused({ paths }, JSON.stringify(paths));
  });

  test('명령: 글자만, 길이 한도', () => {
    refused({ setup: 1 }, '숫자');
    refused({ setup: 'x'.repeat(2_001) }, '긴 setup');
    refused({ checks: ['ok', ''] }, '빈 검사');
    refused({ checks: 'pnpm test' }, '목록이 아님');
    refused({ checks: Array.from({ length: 11 }, () => 'x') }, '너무 많음');
    assert.throws(() => CodeSpec.from(TASK, null), CodeSpecProblem);
    assert.throws(() => CodeSpec.from('../x', good), CodeSpecProblem, '작업 id도 경로에 쓰므로');
  });

  test('AI에게 주는 단락에는 경로 · 검사 명령 · 늘 막는 곳이 있다', () => {
    const brief = spec().brief(REPO_PROMPTS);
    assert.match(brief, /apps\/server\/src\/modules\/blog/);
    assert.match(brief, /pnpm test/);
    assert.match(brief, /\.github\/workflows/);
    assert.match(brief, /커밋 · push/);
  });
});
