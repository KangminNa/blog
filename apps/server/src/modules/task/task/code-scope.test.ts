import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CodeScope } from './code-scope';

// 코드 작업의 자리(저장소 + 경로)와 겹침 (DB 없이). 빌리기와 위임이 같은 규칙을 쓴다.

const scope = (url: string, paths: unknown[]) => CodeScope.of({ code: { repo: { url }, paths } });
const APP = 'https://github.com/me/app';

describe('CodeScope', () => {
  test('payload.code가 없거나 모양이 틀리면 null', () => {
    assert.equal(CodeScope.of(null), null);
    assert.equal(CodeScope.of({ delegatedBy: 'x' }), null);
    assert.equal(CodeScope.of({ code: { repo: {}, paths: ['src'] } }), null);
    assert.equal(scope(APP, []), null);
  });

  test('같은 저장소는 주소의 대소문자 · 끝의 / · .git과 상관없다', () => {
    const a = scope('https://github.com/Me/App.git', ['src']);
    const b = scope(`${APP}/`, ['src/x']);
    assert.ok(a && b && a.overlaps(b));
    const other = scope('https://github.com/me/other', ['src']);
    assert.ok(a && other && !a.overlaps(other), '다른 저장소는 겹치지 않는다');
  });

  test('접두어 폴더로 겹친다: 저장소 전체(.)는 모두와, a/b는 a/b/…와, a/bc와는 아니다', () => {
    const whole = scope(APP, ['./']);
    const ab = scope(APP, ['a/b/']);
    const deep = scope(APP, ['a/b/c.ts']);
    const abc = scope(APP, ['a/bc']);
    assert.deepEqual(whole?.paths, ['.']);
    assert.ok(whole && ab && whole.overlaps(ab));
    assert.ok(ab && deep && ab.overlaps(deep) && deep.overlaps(ab));
    assert.ok(ab && abc && !ab.overlaps(abc));
  });

  test('좁히기: 위 작업의 경로 안만, 한도 · 상대 경로 규칙', () => {
    const parent = scope(APP, ['src', 'docs']) as CodeScope;
    assert.deepEqual(parent.narrowTo(['src/a', 'docs', 'src/a/']).paths, ['src/a', 'docs']);
    assert.throws(() => parent.narrowTo(['test']), /밖이에요/);
    assert.throws(() => parent.narrowTo([]), /paths/);
    assert.throws(() => parent.narrowTo(Array.from({ length: 21 }, (_, i) => `src/${i}`)), /20개/);
    assert.throws(() => parent.narrowTo([`src/${'x'.repeat(200)}`]), /상대 경로/);
    assert.throws(() => parent.narrowTo(['src\\\\a']), /상대 경로/);
    const whole = scope(APP, ['.']) as CodeScope;
    assert.deepEqual(whole.narrowTo(['anything/here']).paths, ['anything/here']);
    assert.deepEqual(whole.narrowTo(['src']).toPayload(), {
      repo: { url: APP },
      paths: ['src'],
    });
  });
});
