import { crc32, inflateRawSync } from 'node:zlib';
import { RuleViolation, TooLarge } from './errors';

/** 풀기 전에 정하는 한도. 작은 zip이 풀면 엄청나게 커지는 것(zip 폭탄)을 막는다 */
export class ZipLimits {
  private static readonly GIB = 1024 ** 3;
  static readonly DEFAULT = new ZipLimits(50_000, 2 * ZipLimits.GIB, 2 * ZipLimits.GIB);

  constructor(
    readonly maxEntries: number,
    /** 푼 뒤의 크기 합 */
    readonly maxBytes: number,
    /** zip 파일 자체의 크기 */
    readonly maxZipBytes: number,
  ) {}
}

// zip 파일 읽기 (라이브러리 없이, node:zlib로 직접). ZipFile의 반대쪽이다.
// 믿을 수 없는 파일로 보고 읽는다: 목록(central directory)을 먼저 읽어 개수·크기·이름을 다 본 뒤에 푼다.
// 푸는 크기는 목록에 적힌 크기까지만이라 목록이 거짓이어도 한도를 넘지 못한다.
// stored와 deflate만 읽는다. 암호·zip64·이름 겹침·폴더 밖으로 나가는 이름은 거절한다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 읽기 한 곳. ZipFile과 나란히 둔다
export class ZipReader {
  private static readonly END = 0x06054b50;
  private static readonly CENTRAL = 0x02014b50;
  private static readonly LOCAL = 0x04034b50;
  private static readonly END_SIZE = 22;
  private static readonly CENTRAL_SIZE = 46;
  private static readonly LOCAL_SIZE = 30;
  private static readonly COMMENT_MAX = 0xffff;
  private static readonly STORED = 0;
  private static readonly DEFLATE = 8;
  private static readonly ZIP64 = 0xffffffff;
  private static readonly ENCRYPTED_FLAG = 1;
  private static readonly DRIVE = /^[A-Za-z]:/;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 이름의 제어 문자를 막는 검사다
  private static readonly CONTROL = /[\u0000-\u001f\u007f]/;

  /** 경로 → 내용. 폴더 항목은 건너뛴다 */
  static read(zip: Buffer, limits: ZipLimits = ZipLimits.DEFAULT): ReadonlyMap<string, Buffer> {
    if (zip.length > limits.maxZipBytes) throw ZipReader.tooLarge(limits.maxZipBytes);
    const end = ZipReader.findEnd(zip);
    const count = zip.readUInt16LE(end + 10);
    const directorySize = zip.readUInt32LE(end + 12);
    const directory = zip.readUInt32LE(end + 16);
    if (directory === ZipReader.ZIP64 || count === 0xffff)
      throw new RuleViolation('zip64 파일은 읽지 못해요');
    if (count > limits.maxEntries)
      throw new TooLarge(`zip 안의 파일이 너무 많아요 (${limits.maxEntries}개까지)`);
    if (directory + directorySize > end) throw ZipReader.broken('목록의 위치가 맞지 않아요');

    const found = new Map<string, Buffer>();
    let at = directory;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (at + ZipReader.CENTRAL_SIZE > end || zip.readUInt32LE(at) !== ZipReader.CENTRAL)
        throw ZipReader.broken('목록을 읽을 수 없어요');
      const nameLength = zip.readUInt16LE(at + 28);
      const next =
        at +
        ZipReader.CENTRAL_SIZE +
        nameLength +
        zip.readUInt16LE(at + 30) +
        zip.readUInt16LE(at + 32);
      if (next > end) throw ZipReader.broken('목록을 읽을 수 없어요');
      const nameBytes = zip.subarray(
        at + ZipReader.CENTRAL_SIZE,
        at + ZipReader.CENTRAL_SIZE + nameLength,
      );
      const name = ZipReader.safeName(nameBytes);
      const size = zip.readUInt32LE(at + 24);
      if (zip.readUInt16LE(at + 8) & ZipReader.ENCRYPTED_FLAG)
        throw new RuleViolation(`암호가 걸린 파일은 읽지 못해요: ${name}`);
      total += size;
      if (total > limits.maxBytes) throw ZipReader.tooLarge(limits.maxBytes);
      if (!name.endsWith('/')) {
        if (found.has(name)) throw new RuleViolation(`zip 안에 같은 이름이 두 번 있어요: ${name}`);
        found.set(name, ZipReader.extract(zip, at, directory, nameBytes, name, size));
      }
      at = next;
    }
    return found;
  }

  /** 끝 표시를 뒤에서부터 찾는다. 뒤에 다른 내용이 붙어 있으면 깨진 파일로 본다 */
  private static findEnd(zip: Buffer): number {
    const lowest = Math.max(0, zip.length - ZipReader.END_SIZE - ZipReader.COMMENT_MAX);
    for (let at = zip.length - ZipReader.END_SIZE; at >= lowest; at--) {
      if (zip.readUInt32LE(at) !== ZipReader.END) continue;
      if (at + ZipReader.END_SIZE + zip.readUInt16LE(at + 20) === zip.length) return at;
    }
    throw ZipReader.broken('zip 파일이 아니에요');
  }

  /** 폴더 밖으로 나갈 수 있는 이름을 거절한다. 이름이 곧 경로가 되는 쪽을 위해 여기서 먼저 막는다 */
  private static safeName(bytes: Buffer): string {
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw ZipReader.broken('이름을 읽을 수 없어요');
    }
    const parts = name.replace(/\/$/, '').split('/');
    if (
      name === '' ||
      name.startsWith('/') ||
      name.includes('\\') ||
      ZipReader.CONTROL.test(name) ||
      ZipReader.DRIVE.test(name) ||
      parts.some((p) => p === '' || p === '.' || p === '..')
    )
      throw new RuleViolation(`위험한 경로예요: ${name}`);
    return name;
  }

  private static extract(
    zip: Buffer,
    central: number,
    directory: number,
    nameBytes: Buffer,
    name: string,
    size: number,
  ): Buffer {
    const offset = zip.readUInt32LE(central + 42);
    const packedSize = zip.readUInt32LE(central + 20);
    const body = offset + ZipReader.LOCAL_SIZE;
    if (body > directory || zip.readUInt32LE(offset) !== ZipReader.LOCAL)
      throw ZipReader.broken(`파일을 찾을 수 없어요: ${name}`);
    const localName = zip.readUInt16LE(offset + 26);
    const start = body + localName + zip.readUInt16LE(offset + 28);
    if (start + packedSize > directory || !zip.subarray(body, body + localName).equals(nameBytes))
      throw ZipReader.broken(`파일을 찾을 수 없어요: ${name}`);
    const data = ZipReader.unpack(
      zip.subarray(start, start + packedSize),
      zip.readUInt16LE(central + 10),
      size,
      name,
    );
    if (data.length !== size) throw ZipReader.broken(`크기가 맞지 않아요: ${name}`);
    if (crc32(data) >>> 0 !== zip.readUInt32LE(central + 16))
      throw ZipReader.broken(`내용 검사값이 맞지 않아요: ${name}`);
    return data;
  }

  private static unpack(packed: Buffer, method: number, size: number, name: string): Buffer {
    if (method === ZipReader.STORED) return packed;
    if (method !== ZipReader.DEFLATE)
      throw new RuleViolation(`읽지 못하는 압축 방식이에요: ${name}`);
    try {
      return inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) });
    } catch {
      throw ZipReader.broken(`풀 수 없어요: ${name}`);
    }
  }

  private static broken(detail: string): RuleViolation {
    return new RuleViolation(`깨진 zip 파일이에요. ${detail}`);
  }

  private static tooLarge(bytes: number): TooLarge {
    return new TooLarge(`zip이 너무 커요 (${Math.round(bytes / 1024 ** 2)}MB까지)`);
  }
}
