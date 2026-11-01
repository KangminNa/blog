import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { InvalidRequest } from '../../platform';
import { BasketItem } from './basket';
import { AddBasketItemInput } from './basket.input';

// 소재의 입력 규칙 (DB 없이).

const requestId = '0192d2a0-0000-7000-8000-0000000000aa';
const refId = '0192d2a0-0000-7000-8000-0000000000bb';

function problems(raw: Record<string, unknown>): ReadonlyMap<string, string> {
  try {
    AddBasketItemInput.from({ requestId, ...raw });
  } catch (error) {
    if (error instanceof InvalidRequest) return error.fields;
    throw error;
  }
  return new Map();
}

describe('BasketItem.linkOf', () => {
  test('http·https만 받고 주소를 다듬는다', () => {
    assert.equal(BasketItem.linkOf(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
    assert.equal(BasketItem.linkOf('http://example.com'), 'http://example.com/');
    assert.equal(BasketItem.linkOf('HTTPS://EXAMPLE.com'), 'https://example.com/');
  });

  test('그 밖의 주소는 null', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
      'example.com',
      '/admin',
      'https://',
    ])
      assert.equal(BasketItem.linkOf(bad), null, bad);
  });
});

describe('AddBasketItemInput', () => {
  test('종류마다 필요한 칸', () => {
    assert.equal(problems({ kind: 'session', refId }).size, 0);
    assert.equal(problems({ kind: 'post', refId }).size, 0);
    assert.equal(problems({ kind: 'link', url: 'https://example.com' }).size, 0);
    assert.equal(problems({ kind: 'note', note: '메모' }).size, 0);
    assert.ok(problems({ kind: 'session' }).has('refId'));
    assert.ok(problems({ kind: 'post', refId: '아님' }).has('refId'));
    assert.ok(problems({ kind: 'link' }).has('url'));
    assert.ok(problems({ kind: 'link', url: 'javascript:alert(1)' }).has('url'));
    assert.ok(problems({ kind: 'note' }).has('note'));
    assert.ok(problems({ kind: 'note', note: '   ' }).has('note'));
  });

  test('사진·파일은 올리는 길이 없어 아직 받지 않는다', () => {
    assert.ok(problems({ kind: 'photo' }).has('kind'));
    assert.ok(problems({ kind: 'file' }).has('kind'));
    assert.ok(problems({ kind: '모르는 종류' }).has('kind'));
  });

  test('다른 종류의 칸은 저장하지 않는다', () => {
    const input = AddBasketItemInput.from({
      requestId,
      kind: 'note',
      note: ' 메모 ',
      url: 'javascript:alert(1)',
      refId,
    });
    assert.equal(input.note, '메모');
    assert.equal(input.url, null);
    assert.equal(input.refId, null);
  });
});
