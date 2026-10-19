import { crc32, deflateRawSync } from 'node:zlib';

// zip 파일 만들기 (라이브러리 없이, node:zlib로 직접. 2026-10-10 결정).
// 지금은 ChatGPT·Claude 앱에 올릴 스킬 묶음에 쓴다. 나중에 보관 형식 내보내기(zip)도 이것을 쓴다.
// 파일마다 deflate로 줄이고, 이름은 UTF-8로 적는다 (일반 플래그 11번 비트).
/** zip 안의 파일 하나 */
class ZipEntry {
  readonly packed: Buffer;
  readonly crc: number;

  constructor(
    readonly name: Buffer,
    readonly data: Buffer,
  ) {
    this.packed = deflateRawSync(data);
    this.crc = crc32(data);
  }
}

export class ZipFile {
  /** 파일 시각은 모두 1980-01-01 00:00 (같은 내용이면 같은 zip이 나온다) */
  private static readonly DOS_TIME = 0x0021_0000;

  private readonly entries: ZipEntry[] = [];

  /** path는 묶음 안의 경로 (예: cairn-save/SKILL.md) */
  add(path: string, content: string | Buffer): this {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    this.entries.push(new ZipEntry(Buffer.from(path, 'utf8'), data));
    return this;
  }

  toBuffer(): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const e of this.entries) {
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // 풀 때 필요한 버전
      local.writeUInt16LE(0x0800, 6); // 이름이 UTF-8
      local.writeUInt16LE(8, 8); // deflate
      local.writeUInt32LE(ZipFile.DOS_TIME, 10);
      local.writeUInt32LE(e.crc >>> 0, 14);
      local.writeUInt32LE(e.packed.length, 18);
      local.writeUInt32LE(e.data.length, 22);
      local.writeUInt16LE(e.name.length, 26);
      local.writeUInt16LE(0, 28);
      locals.push(local, e.name, e.packed);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(ZipFile.DOS_TIME, 12);
      central.writeUInt32LE(e.crc >>> 0, 16);
      central.writeUInt32LE(e.packed.length, 20);
      central.writeUInt32LE(e.data.length, 24);
      central.writeUInt16LE(e.name.length, 28);
      central.writeUInt32LE(offset, 42);
      centrals.push(central, e.name);
      offset += 30 + e.name.length + e.packed.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
  }
}
