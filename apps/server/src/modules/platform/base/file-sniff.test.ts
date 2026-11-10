import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FileSniff } from './file-sniff';

// 파일의 앞부분으로 형식을 알아본다 (DB 없이). 사진 넷은 blog의 ImagePolicy 시험에도 있다.

const bytes = (...values: number[]) => Buffer.from(values);

describe('FileSniff', () => {
  test('PDF · MP4 · WebM · zip(docx · pptx · xlsx)을 앞부분으로 알아본다', () => {
    assert.equal(FileSniff.mimeOf(Buffer.from('%PDF-1.7\n%')), FileSniff.PDF);
    assert.equal(FileSniff.mimeOf(Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00')), FileSniff.MP4);
    assert.equal(FileSniff.mimeOf(Buffer.from('\x00\x00\x00\x20ftypisom\x00\x00')), FileSniff.MP4);
    assert.equal(FileSniff.mimeOf(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01)), FileSniff.WEBM);
    assert.equal(FileSniff.mimeOf(bytes(0x50, 0x4b, 0x03, 0x04, 0x14)), FileSniff.ZIP);
    assert.equal(
      FileSniff.mimeOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
      FileSniff.PNG,
    );
  });

  test('앞부분에 표시가 없는 것과 QuickTime은 null', () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<!doctype html><script>',
      '# 제목\n본문',
      'a,b,c\n1,2,3',
      '\x00\x00\x00\x14ftypqt  \x00\x00',
      '%PD',
      '',
    ])
      assert.equal(FileSniff.mimeOf(Buffer.from(text)), null, JSON.stringify(text));
  });
});
