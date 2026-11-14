import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RuleViolation, SensitivePolicy } from '../../platform';
import { SessionNote } from './session-note';
import { SessionTranscript } from './session-transcript';

// 원문과 서버 러너의 노트 답 (2차 4단계): 비밀값 지우기, AI에게 줄 글 줄이기, 답(JSON) 읽기

describe('SessionTranscript', () => {
  const policy = new SensitivePolicy();

  test('비밀값을 지우고, 같은 글은 같은 해시. 빈 글은 받지 않는다', () => {
    const a = SessionTranscript.scrubbed(`키: sk-ant-api03-${'a'.repeat(40)}\n끝`, policy);
    assert.ok(!a.text.includes('sk-ant-api03'));
    assert.equal(a.redactions.length, 1);
    const b = SessionTranscript.scrubbed(`  키: sk-ant-api03-${'a'.repeat(40)}\n끝 `, policy);
    assert.equal(a.hash, b.hash, '앞뒤 공백은 다른 원문이 아니다');
    assert.throws(() => SessionTranscript.scrubbed('   ', policy), RuleViolation);
  });

  test('AI에게는 앞 4만 · 뒤 8만 자를 남기고 가운데를 줄였다고 적는다', () => {
    const short = SessionTranscript.restore('짧은 원문');
    assert.equal(short.forPrompt(), '짧은 원문');
    const long = SessionTranscript.restore(`${'앞'.repeat(50_000)}${'뒤'.repeat(90_000)}`);
    const text = long.forPrompt();
    assert.ok(text.startsWith('앞'.repeat(40_000)));
    assert.ok(text.endsWith('뒤'.repeat(80_000)));
    assert.match(text, /가운데 20000자 줄임/);
  });
});

describe('SessionNote.fromAnswer', () => {
  test('코드 블록 안의 JSON도 읽고, 목록 칸은 줄마다 "- "로', () => {
    const note = SessionNote.fromAnswer(
      '노트예요\n```json\n{"title":"한 일","did":["가","나"],"decisions":"정함","tags":["t"]}\n```',
    );
    assert.equal(note.title, '한 일');
    assert.equal(note.section('did'), '- 가\n- 나');
    assert.equal(note.section('decisions'), '정함');
    assert.deepEqual(note.tags, ['t']);
  });

  test('JSON이 아니거나 제목 · 내용이 없으면 RuleViolation. 긴 칸은 자른다', () => {
    assert.throws(() => SessionNote.fromAnswer('노트를 못 썼어요'), /JSON/);
    assert.throws(() => SessionNote.fromAnswer('[1, 2]'), /JSON/);
    assert.throws(() => SessionNote.fromAnswer('{"did":"내용만"}'), /제목/);
    assert.throws(() => SessionNote.fromAnswer('{"title":"제목만"}'), RuleViolation);
    const long = SessionNote.fromAnswer(
      JSON.stringify({ title: 'x'.repeat(300), quotes: 'q'.repeat(5_000), extra: 1 }),
    );
    assert.equal(long.title.length, SessionNote.TITLE_MAX);
    assert.equal(long.section('quotes').length, SessionNote.QUOTES_MAX);
    assert.equal(long.section('extra'), '', '글이 아닌 값은 비운다');
  });
});
