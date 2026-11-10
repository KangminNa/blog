import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { AllowList, AllowListProblem } from './allow-list';

describe('허용 목록', () => {
  test('호스트 하나와 하위 도메인 규칙. 주석 · 빈 줄 · 대소문자 · 끝의 점은 무시한다', () => {
    const allow = AllowList.parse(
      [
        '# 맨 위 주석',
        '',
        'GitHub.com  # 뒤 주석',
        '.githubusercontent.com',
        '  registry.npmjs.org  ',
      ].join('\n'),
    );
    assert.equal(allow.size, 3);
    assert.equal(allow.allows('github.com'), true);
    assert.equal(allow.allows('GITHUB.COM.'), true);
    assert.equal(allow.allows('registry.npmjs.org'), true);
    assert.equal(allow.allows('raw.githubusercontent.com'), true);
    assert.equal(allow.allows('a.b.githubusercontent.com'), true);
  });

  test('목록에 없는 이름은 막는다: 꼬리 붙이기 · 앞 붙이기 · 하위 도메인 · 하위 규칙의 자기 자신', () => {
    const allow = AllowList.parse('github.com\n.githubusercontent.com');
    assert.equal(allow.allows('github.com.evil.io'), false);
    assert.equal(allow.allows('evilgithub.com'), false);
    assert.equal(
      allow.allows('api.github.com'),
      false,
      '정확한 이름 규칙은 하위 도메인을 열지 않는다',
    );
    assert.equal(allow.allows('githubusercontent.com.evil.io'), false);
    assert.equal(allow.allows('evilgithubusercontent.com'), false);
    assert.equal(allow.allows('githubusercontent.com'), false, '필요하면 따로 적는다');
    assert.equal(allow.allows(''), false);
  });

  test('틀린 줄이 있으면 몇 번째 줄인지 알리고 시작하지 않는다', () => {
    for (const line of [
      '*',
      '*.github.com',
      '1.2.3.4',
      'github.com:443',
      'https://github.com',
      'github.com/path',
      '.com',
      'localhost',
      '-bad.example.com',
      'bad_name.example.com',
    ])
      assert.throws(
        () => AllowList.parse(`github.com\n${line}`),
        (error: Error) => error instanceof AllowListProblem && error.message.startsWith('2번째 줄'),
        line,
      );
  });

  test('저장소의 기본 허용 목록(egress/allow.txt)은 읽힌다', () => {
    const text = readFileSync(join(__dirname, '../../../egress/allow.txt'), 'utf8');
    const allow = AllowList.parse(text);
    assert.ok(allow.size > 0);
    assert.equal(allow.allows('github.com'), true);
    assert.equal(allow.allows('registry.npmjs.org'), true);
    assert.equal(allow.allows('example.com'), false);
  });
});
