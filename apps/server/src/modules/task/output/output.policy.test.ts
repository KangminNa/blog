import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FileSniff, RuleViolation } from '../../platform';
import { OutputPolicy } from './output.policy';

// 결과물의 이름 · 종류 · 형식 · 한도 (DB 없이).

const GB = 1024 * 1024 * 1024;

describe('OutputPolicy', () => {
  test('이름: 폴더 · 제어 문자 · 숨김 · 앞뒤 공백 · 너무 긴 이름은 거절, 한글 이름은 받는다', () => {
    for (const name of ['보고서 최종.pptx', 'chart_01.png', 'a.b.c.md'])
      assert.doesNotThrow(() => OutputPolicy.assertName(name), name);
    for (const name of ['', '.env', '../a', 'a/b', 'a\\b', 'a\tb', ' a', 'a ', 'x'.repeat(121)])
      assert.throws(() => OutputPolicy.assertName(name), RuleViolation, JSON.stringify(name));
  });

  test('종류 · 형식: 앞부분이 먼저, zip과 글자 파일은 이름으로, 모르면 other', () => {
    assert.equal(OutputPolicy.kindOf('a.bin', FileSniff.PDF), 'document');
    assert.equal(OutputPolicy.mimeOf('a.bin', FileSniff.PDF), FileSniff.PDF);
    assert.equal(OutputPolicy.kindOf('deck.pptx', FileSniff.ZIP), 'slides');
    assert.match(OutputPolicy.mimeOf('deck.pptx', FileSniff.ZIP), /presentationml/);
    assert.equal(OutputPolicy.mimeOf('a.zip', FileSniff.ZIP), FileSniff.ZIP);
    assert.equal(OutputPolicy.kindOf('표.CSV', null), 'sheet');
    assert.equal(OutputPolicy.kindOf('page.html', null), 'other');
    assert.equal(OutputPolicy.mimeOf('page.html', null), OutputPolicy.OCTET);
    assert.equal(OutputPolicy.kindOf('fake.png', null), 'other', '그림인지는 내용으로만');
  });

  test('미리 보기는 앞부분으로 알아본 그림 · PDF · 영상만. SVG · 글자는 내려받기만', () => {
    for (const mime of [FileSniff.PNG, FileSniff.PDF, FileSniff.MP4])
      assert.equal(OutputPolicy.canInline(mime), true);
    for (const mime of ['image/svg+xml', 'text/markdown', 'text/html', OutputPolicy.OCTET])
      assert.equal(OutputPolicy.canInline(mime), false, mime);
  });

  test('한도: 파일 하나 100MB, 실행 한 번 200개 · 1GB, 공간 한도와 디스크 여유', () => {
    assert.doesNotThrow(() => OutputPolicy.assertRun(199, 0, OutputPolicy.FILE_MAX));
    assert.throws(() => OutputPolicy.assertRun(0, 0, OutputPolicy.FILE_MAX + 1), RuleViolation);
    assert.throws(() => OutputPolicy.assertRun(200, 0, 1), RuleViolation);
    assert.throws(() => OutputPolicy.assertRun(1, GB, 1), RuleViolation);
    const policy = new OutputPolicy(100, 50);
    assert.doesNotThrow(() => policy.assertRoom(90, 1000, 10));
    assert.throws(() => policy.assertRoom(91, 1000, 10), /저장 공간/);
    assert.throws(() => policy.assertRoom(0, 59, 10), /디스크 여유/);
  });

  test('서버 설정: 기본 80GB · 여유 20GB, 소수 GB도 받고 틀린 값은 시작부터 실패', () => {
    const fallback = OutputPolicy.fromEnv({});
    assert.equal(fallback.maxBytes, 80 * GB);
    assert.equal(fallback.reserveBytes, 20 * GB);
    assert.equal(OutputPolicy.fromEnv({ CAIRN_OUTPUTS_MAX_GB: '0.5' }).maxBytes, GB / 2);
    assert.throws(() => OutputPolicy.fromEnv({ CAIRN_OUTPUTS_MAX_GB: '많이' }));
    assert.throws(() => OutputPolicy.fromEnv({ CAIRN_DISK_RESERVE_GB: '-1' }));
  });
});
