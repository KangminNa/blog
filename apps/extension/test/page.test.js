import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { askMessage, keepArgs } from '../src/page.js';

const page = {
  url: 'https://news.example/articles/1?ref=home',
  title: '  긴 글의\n제목 ',
  selection: '',
  text: '본문 첫 줄\n\n\n\n본문 둘째 줄   \n끝',
};

describe('이 페이지 보관 (keep_page)', () => {
  it('고른 부분이 없으면 본문의 앞부분', () => {
    assert.deepEqual(keepArgs(page, 'r1'), {
      request_id: 'r1',
      url: 'https://news.example/articles/1?ref=home',
      title: '긴 글의 제목',
      text: '본문 첫 줄\n\n본문 둘째 줄\n끝',
    });
  });

  it('고른 부분이 있으면 그것만', () => {
    assert.equal(keepArgs({ ...page, selection: ' 이 문단 ' }, 'r1').text, '이 문단');
  });

  it('길이에 맞춰 자르고, 제목이 없으면 주소로', () => {
    const args = keepArgs({ ...page, title: '', text: 'x'.repeat(20_000) }, 'r1');
    assert.equal(args.text.length, 10_000);
    assert.equal(args.title, page.url);
    assert.equal(keepArgs({ ...page, title: '가'.repeat(500) }, 'r1').title.length, 200);
    assert.equal('text' in keepArgs({ ...page, text: '  ' }, 'r1'), false);
  });

  it('웹 페이지가 아니거나 주소가 너무 길면 Problem', () => {
    assert.throws(() => keepArgs({ ...page, url: 'chrome://settings' }, 'r1'), /웹 페이지에서만/);
    assert.throws(
      () => keepArgs({ ...page, url: `https://a.example/${'x'.repeat(2000)}` }, 'r1'),
      /2000자까지/,
    );
    assert.throws(() => keepArgs({ ...page, url: '' }, 'r1'), /주소를 읽지 못했어요/);
  });
});

describe('이 페이지로 맡기기 (ask_agent)', () => {
  it('사용자의 말, 페이지 주소 · 제목, 고른 부분 순서', () => {
    assert.equal(
      askMessage(' 이 글을 세 줄로 요약해 줘 ', { ...page, selection: '중요한 문단' }),
      '이 글을 세 줄로 요약해 줘\n\n페이지: https://news.example/articles/1?ref=home\n제목: 긴 글의 제목\n\n고른 부분:\n중요한 문단',
    );
  });

  it('고른 부분이 없으면 · 페이지를 읽지 못했으면 그만큼 빠진다', () => {
    assert.equal(
      askMessage('요약해 줘', { ...page, title: '' }),
      '요약해 줘\n\n페이지: https://news.example/articles/1?ref=home',
    );
    assert.equal(askMessage('그냥 맡길 일', null), '그냥 맡길 일');
  });

  it('8000자를 넘으면 고른 부분을 줄인다', () => {
    const message = askMessage('요약해 줘', { ...page, selection: 's'.repeat(20_000) });
    assert.equal(message.length, 8000);
    assert.ok(message.startsWith('요약해 줘\n\n페이지: '));
    assert.ok(message.endsWith('s'));
  });

  it('말이 없으면 Problem', () => {
    assert.throws(() => askMessage('   ', page), /맡길 일을 적어 주세요/);
  });
});
