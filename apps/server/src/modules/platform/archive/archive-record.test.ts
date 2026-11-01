import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ArchiveFile } from './archive-file';
import { ArchiveRecord } from './archive-record';

// 복원이 읽는 쪽: ArchiveFile이 쓴 것을 그대로 되읽고, 손으로 고친 파일의 흔한 모양도 읽고, 모르는 키는 글자 그대로 남긴다.

describe('ArchiveRecord', () => {
  test('ArchiveFile.markdown이 쓴 값을 그대로 되읽는다', () => {
    const when = new Date('2026-10-31T09:40:00.000Z');
    const file = ArchiveFile.markdown(
      'vault/wikis/a.md',
      {
        plain: '평범한 제목',
        quoted: 'a: "b"\n둘째 줄',
        number: '123',
        word: 'yes',
        list: ['a,b', '다', '"따옴표"'],
        none: null,
        count: 3,
        on: true,
        when,
      },
      '\n본문 첫 줄이 빈 줄\n---\n가로줄도 본문\n',
    );
    const record = ArchiveRecord.ofMarkdown(file.path, file.asText());
    assert.equal(record.text('plain'), '평범한 제목');
    assert.equal(record.text('quoted'), 'a: "b"\n둘째 줄');
    assert.equal(record.text('number'), '123');
    assert.equal(record.text('word'), 'yes');
    assert.deepEqual(record.texts('list'), ['a,b', '다', '"따옴표"']);
    assert.equal(record.optionalText('none'), null);
    assert.equal(record.number('count'), 3);
    assert.equal(record.flag('on', false), true);
    assert.deepEqual(record.date('when'), when);
    assert.equal(record.body, '\n본문 첫 줄이 빈 줄\n---\n가로줄도 본문\n');
  });

  test('옵시디언이 쓰는 줄 목록과 작은따옴표를 읽는다', () => {
    const record = ArchiveRecord.ofMarkdown(
      'x.md',
      "---\ntags:\n  - 하나\n  - 둘\ntitle: 'it''s'\nempty:\n---\n\n본문",
    );
    assert.deepEqual(record.texts('tags'), ['하나', '둘']);
    assert.equal(record.text('title'), "it's");
    assert.equal(record.optionalText('empty'), null);
  });

  test('모르는 키는 적힌 글자 그대로 남고, 다음 내보내기에서 돌아온다', () => {
    const text =
      '---\ntitle: 제목\ncustom: "값: 그대로"\naliases:\n  - 하나\n  - "둘"\n# 주석\n---\n\n본문';
    const record = ArchiveRecord.ofMarkdown('x.md', text);
    const kept = record.unknownKeys(new Set(['title']));
    assert.deepEqual(Object.keys(kept), ['custom', 'aliases']);
    const again = ArchiveFile.markdown('vault/wikis/x.md', { title: '제목' }, '본문', kept);
    assert.equal(again.asText(), text);
    assert.deepEqual(ArchiveFile.keptIn(ArchiveFile.metaOf(kept)), kept);
    assert.deepEqual(ArchiveFile.metaOf({}), {});
    assert.deepEqual(ArchiveFile.keptIn({}), {});
  });

  test('모르는 키의 깨진 값은 멈추지 않지만 아는 키는 멈춘다', () => {
    const record = ArchiveRecord.ofMarkdown('x.md', '---\ntitle: "닫히지 않음\n---\n\n본문');
    assert.deepEqual(Object.keys(record.unknownKeys(new Set())), ['title']);
    assert.throws(() => record.text('title'), /x\.md: title의 따옴표/);
  });

  test('틀린 모양은 어느 파일의 무엇인지 알려 준다', () => {
    const record = ArchiveRecord.ofMarkdown(
      'x.md',
      '---\ncairn_id: 아이디\nwhen: 어제\nstatus: 이상함\ncount: 많음\n---\n\n',
    );
    assert.throws(() => record.id(), /x\.md: cairn_id이\(가\) id 모양이 아니에요/);
    assert.throws(() => record.date('when'), /날짜가 아니에요/);
    assert.throws(() => record.oneOf('status', ['draft']), /draft 중 하나/);
    assert.throws(() => record.number('count'), /숫자여야/);
    assert.throws(() => record.text('없는 키'), /없어요/);
  });

  test('앞부분이 없거나 키가 겹치면 멈춘다', () => {
    assert.throws(() => ArchiveRecord.ofMarkdown('x.md', '본문만'), /앞부분/);
    assert.throws(() => ArchiveRecord.ofMarkdown('x.md', '---\na: 1\na: 2\n---\n\n'), /두 번/);
  });

  test('UUIDv7 id에서 만든 때를 읽는다', () => {
    const record = ArchiveRecord.ofMarkdown(
      'x.md',
      '---\ncairn_id: "019a2b3c-4d5e-7f00-8000-000000000001"\n---\n\n',
    );
    assert.deepEqual(record.createdAt, new Date(0x019a2b3c4d5e));
  });

  test('yml 목록과 빈 목록', () => {
    const file = ArchiveFile.yamlList('vault/categories.yml', [
      { name: '구역: 하나', sort: 1, description: '여러 줄\n기준' },
      { name: '둘', sort: 2, description: null },
    ]);
    const [first, second] = ArchiveRecord.listOfYaml(file.path, file.asText());
    assert.equal(first?.text('name'), '구역: 하나');
    assert.equal(first?.text('description'), '여러 줄\n기준');
    assert.equal(second?.number('sort'), 2);
    assert.equal(second?.optionalText('description'), null);
    assert.deepEqual(ArchiveRecord.listOfYaml('x.yml', '[]\n'), []);
    assert.throws(() => ArchiveRecord.listOfYaml('x.yml', '이상한 줄'), /읽을 수 없는 줄/);
  });
});
