import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ImagePolicy } from './image.policy';

// 파일의 앞부분으로 형식을 정한다 (DB 없이).

const bytes = (...values: number[]) => Buffer.from(values);

describe('ImagePolicy', () => {
  test('PNG · JPEG · GIF · WebP를 앞부분으로 알아본다', () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
    assert.equal(ImagePolicy.mimeOf(png), 'image/png');
    assert.equal(ImagePolicy.mimeOf(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
    assert.equal(ImagePolicy.mimeOf(Buffer.from('GIF87a...')), 'image/gif');
    assert.equal(ImagePolicy.mimeOf(Buffer.from('GIF89a...')), 'image/gif');
    assert.equal(ImagePolicy.mimeOf(Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ')), 'image/webp');
  });

  test('받지 않는 것은 null: SVG, HTML, 다른 RIFF, 잘린 앞부분, 빈 파일', () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<?xml version="1.0"?><svg/>',
      '<html></html>',
      'RIFF\x10\x00\x00\x00WAVEfmt ',
      'GIF90a',
      '',
    ])
      assert.equal(ImagePolicy.mimeOf(Buffer.from(text)), null, text);
    assert.equal(ImagePolicy.mimeOf(bytes(0x89, 0x50, 0x4e)), null);
    assert.equal(ImagePolicy.mimeOf(bytes(0xff, 0xd8)), null);
  });
});
