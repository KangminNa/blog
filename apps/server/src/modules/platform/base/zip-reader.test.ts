import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { ArchiveFile } from '../archive/archive-file';
import { TooLarge } from './errors';
import { ZipFile } from './zip-file';
import { ZipLimits, ZipReader } from './zip-reader';

// zip 읽기는 믿을 수 없는 파일을 받는다. ZipFile이 만든 것을 그대로 읽고, 깨진 파일·위험한 이름·폭탄을 거절하는지 본다.

const CENTRAL = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

const zipOf = (entries: Record<string, string | Buffer>): Buffer => {
  const zip = new ZipFile();
  for (const [path, content] of Object.entries(entries)) zip.add(path, content);
  return zip.toBuffer();
};

/** 저장 방식과 적힌 크기까지 마음대로 정한 항목 하나로 된 zip */
function craft(name: string, packed: Buffer, method: number, data: Buffer, declared: number) {
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(data) >>> 0, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data) >>> 0, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const body = Buffer.concat([local, nameBytes, packed]);
  const directory = Buffer.concat([central, nameBytes]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}

describe('ZipReader', () => {
  test('ZipFile이 만든 파일을 바이트까지 그대로 읽는다', () => {
    const photo = Buffer.from([0x89, 0x50, 0, 255, 1, 2, 3]);
    const files = ZipReader.read(zipOf({ 'vault/wikis/한글.md': '본문', 'assets/a.png': photo }));
    assert.equal(files.get('vault/wikis/한글.md')?.toString('utf8'), '본문');
    assert.deepEqual(files.get('assets/a.png'), photo);
    assert.equal(files.size, 2);
  });

  test('빈 파일과 압축하지 않은 항목을 읽고, 폴더 항목은 건너뛴다', () => {
    assert.equal(ZipReader.read(zipOf({ 'a.txt': '' })).get('a.txt')?.length, 0);
    const data = Buffer.from('그대로');
    const stored = craft('b.txt', data, 0, data, data.length);
    assert.deepEqual(ZipReader.read(stored).get('b.txt'), data);
    assert.equal(ZipReader.read(zipOf({ 'folder/': '' })).size, 0);
  });

  test('zip이 아니거나 잘린 파일은 거절한다', () => {
    assert.throws(() => ZipReader.read(Buffer.from('zip이 아니에요')), /zip 파일이 아니에요/);
    assert.throws(() => ZipReader.read(Buffer.alloc(0)), /zip 파일이 아니에요/);
    const zip = zipOf({ 'a.txt': '내용'.repeat(100) });
    assert.throws(() => ZipReader.read(zip.subarray(0, zip.length - 5)), /깨진 zip/);
    assert.throws(() => ZipReader.read(Buffer.concat([zip, Buffer.from('뒤')])), /깨진 zip/);
  });

  test('내용이 바뀌면 거절한다: 푸는 데 실패하거나 검사값이 다르다', () => {
    const zip = zipOf({ 'a.txt': 'a'.repeat(500) });
    zip[40] = (zip[40] ?? 0) ^ 0xff;
    assert.throws(() => ZipReader.read(zip), /깨진 zip/);

    const checksum = zipOf({ 'a.txt': 'a'.repeat(500) });
    const central = checksum.indexOf(CENTRAL);
    checksum.writeUInt32LE(checksum.readUInt32LE(central + 16) ^ 1, central + 16);
    assert.throws(() => ZipReader.read(checksum), /검사값이 맞지 않아요/);
  });

  test('목록의 위치가 파일 밖이면 거절한다', () => {
    const zip = zipOf({ 'a.txt': '내용' });
    const central = zip.indexOf(CENTRAL);
    zip.writeUInt32LE(0x7fffffff, central + 42);
    assert.throws(() => ZipReader.read(zip), /깨진 zip/);
  });

  test('폴더 밖으로 나갈 수 있는 이름은 거절한다', () => {
    for (const name of [
      '../밖.txt',
      'a/../../밖.txt',
      '/etc/passwd',
      'a\\..\\b',
      'C:/Windows/x',
      './a.txt',
      'a//b.txt',
      'a\u0000b',
    ])
      assert.throws(() => ZipReader.read(zipOf({ [name]: 'x' })), /위험한 경로/, name);
  });

  test('같은 이름이 두 번이면 거절한다', () => {
    const zip = new ZipFile().add('a.txt', '하나').add('a.txt', '둘').toBuffer();
    assert.throws(() => ZipReader.read(zip), /두 번/);
  });

  test('암호·모르는 압축 방식은 거절한다', () => {
    const encrypted = zipOf({ 'a.txt': '내용' });
    const central = encrypted.indexOf(CENTRAL);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    assert.throws(() => ZipReader.read(encrypted), /암호/);

    const data = Buffer.from('내용');
    assert.throws(() => ZipReader.read(craft('a.txt', data, 12, data, data.length)), /압축 방식/);
  });

  test('한도를 넘으면 풀기 전에 거절한다', () => {
    const limits = new ZipLimits(2, 100, 10_000);
    assert.throws(
      () => ZipReader.read(zipOf({ a: '1', b: '2', c: '3' }), limits),
      (e) => e instanceof TooLarge && /파일이 너무 많아요/.test(e.message),
    );
    assert.throws(
      () => ZipReader.read(zipOf({ a: 'x'.repeat(60), b: 'x'.repeat(60) }), limits),
      (e) => e instanceof TooLarge && /zip이 너무 커요/.test(e.message),
    );
    assert.throws(
      () => ZipReader.read(zipOf({ a: '1' }), new ZipLimits(2, 100, 10)),
      (e) => e instanceof TooLarge,
    );
  });

  test('zip 폭탄: 작게 적어도 적은 크기 넘게 풀지 않고, 크게 적으면 한도에서 막힌다', () => {
    const huge = Buffer.alloc(50 * 1024 * 1024);
    const packed = deflateRawSync(huge);
    assert.ok(packed.length < 100_000, '작은 파일이 크게 풀린다');
    assert.throws(() => ZipReader.read(craft('bomb', packed, 8, huge, 1024)), /깨진 zip/);
    assert.throws(
      () =>
        ZipReader.read(
          craft('bomb', packed, 8, huge, huge.length),
          new ZipLimits(10, 1024 * 1024, 1024 * 1024),
        ),
      (e) => e instanceof TooLarge,
    );
  });
});

describe('ArchiveFile.unzip', () => {
  test('보관 형식 파일이 된다', () => {
    const [file] = ArchiveFile.unzip(zipOf({ 'cairn.json': '{}' }));
    assert.equal(file?.path, 'cairn.json');
    assert.equal(file?.asText(), '{}');
  });

  test('보관 형식 밖의 경로는 거절한다', () => {
    assert.throws(() => ArchiveFile.unzip(zipOf({ 'README.md': '다른 파일' })), /보관 형식 밖/);
  });
});
