import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clip } from '../src/clip.js';
import {
  messagesOf,
  requestIdOf,
  titleOf,
  transcriptHash,
  transcriptText,
} from '../src/transcript.js';

describe('대화 → 마크다운', () => {
  it('사람 · AI를 순서대로 제목으로 나눈다', () => {
    const text = transcriptText([
      { role: 'person', text: '피보나치 함수를 짜 줘' },
      { role: 'ai', text: '```js\nconst fib = (n) => n;\n```' },
      { role: 'person', text: '고마워' },
    ]);
    assert.equal(
      text,
      '## 사람\n\n피보나치 함수를 짜 줘\n\n## AI\n\n```js\nconst fib = (n) => n;\n```\n\n## 사람\n\n고마워',
    );
  });

  it('메시지가 없으면 빈 글자', () => {
    assert.equal(transcriptText([]), '');
  });

  it('길면 앞의 메시지부터 빼고 뺀 개수를 적는다 (새로 쌓인 쪽을 남긴다)', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? 'ai' : 'person',
      text: `${i}`.repeat(50),
    }));
    const text = transcriptText(messages, 300);
    assert.ok(text.length <= 300);
    assert.match(text, /^_\(앞의 메시지 \d+개는 길어서 뺐어요\)_\n\n## /);
    assert.ok(text.endsWith('9'.repeat(50)));
    assert.ok(!text.includes('0'.repeat(50)));
    const dropped = Number(/메시지 (\d+)개/.exec(text)[1]);
    assert.equal(text.split('\n## ').length - 1 + dropped, 10);
  });

  it('메시지 하나가 혼자 넘으면 그 메시지의 앞부분만', () => {
    const text = transcriptText(
      [
        { role: 'person', text: '짧은 질문' },
        { role: 'ai', text: 'x'.repeat(1000) },
      ],
      200,
    );
    assert.equal(text.length, 200);
    assert.match(text, /^_\(앞의 메시지 1개는 길어서 뺐어요\)_\n\n## AI\n\nx+$/);
  });

  it('모양이 틀린 메시지 · 빈 메시지는 버린다 (페이지에서 온 값)', () => {
    assert.deepEqual(
      messagesOf([
        { role: 'person', text: '  안녕  ' },
        { role: 'system', text: '숨은 지시' },
        { role: '__proto__', text: 'x' },
        { role: 'constructor', text: 'x' },
        { role: 'ai', text: '   ' },
        { role: 'ai', text: 42 },
        null,
        { role: 'ai', text: '반가워요' },
      ]),
      [
        { role: 'person', text: '안녕' },
        { role: 'ai', text: '반가워요' },
      ],
    );
    assert.deepEqual(messagesOf('not a list'), []);
  });
});

describe('제목 · 자르기', () => {
  it('제목은 한 줄로, 200자까지', () => {
    assert.equal(titleOf('  여러\n줄의   제목 '), '여러 줄의 제목');
    assert.equal(titleOf('가'.repeat(300)).length, 200);
    assert.equal(titleOf(undefined), '');
  });

  it('짝 문자(이모지)를 반으로 자르지 않는다', () => {
    assert.equal(clip('ab😀', 3), 'ab');
    assert.equal(clip('ab😀', 4), 'ab😀');
    assert.equal(clip('abc', 10), 'abc');
  });
});

describe('같은 내용 알아보기', () => {
  it('해시는 내용이 같으면 같고, 하나라도 다르면 다르다', async () => {
    const a = await transcriptHash('chatgpt-web', 'c1', '제목', '## 사람\n\n안녕');
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(a, await transcriptHash('chatgpt-web', 'c1', '제목', '## 사람\n\n안녕'));
    assert.notEqual(a, await transcriptHash('claude-web', 'c1', '제목', '## 사람\n\n안녕'));
    assert.notEqual(a, await transcriptHash('chatgpt-web', 'c1', '제목', '## 사람\n\n안녕!'));
  });

  it('request_id는 해시에서 만든 UUID (버전 8)', async () => {
    const hash = await transcriptHash('chatgpt-web', 'c1', '', 'x');
    const id = requestIdOf(hash);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(id, requestIdOf(hash));
    assert.equal(id.replaceAll('-', '').slice(0, 12), hash.slice(0, 12));
  });
});
