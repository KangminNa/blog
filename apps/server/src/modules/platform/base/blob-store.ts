import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { Database } from './database';
import { NotFound, RuleViolation, TooLarge } from './errors';
import { FileSniff } from './file-sniff';

/** 저장된 파일 하나 (platform.blobs). 이름이 곧 내용의 sha256이라 내용이 같으면 파일도 하나다 */
export class Blob {
  private static readonly HASH = /^[0-9a-f]{64}$/;

  constructor(
    readonly hash: string,
    readonly mime: string,
    readonly size: number,
  ) {}

  /** 파일 이름으로 쓸 수 있는 값인가. 이 모양만 디스크 경로에 닿는다 */
  static isHash(value: string): boolean {
    return Blob.HASH.test(value);
  }
}

// 내용 주소 파일 저장소. 파일은 디스크에, 정보는 platform.blobs에 둔다.
// 호출한 쪽의 트랜잭션 밖에서 부른다: 디스크 쓰기를 기다리는 동안 트랜잭션을 열어 두지 않는다.
// 파일을 먼저 쓰고 행을 남기므로 행이 있으면 파일도 있다. 도중에 멈춰도 같은 내용을 다시 올리면 맞춰진다.
// 어느 모듈이 쓰는 파일인지는 모른다. 누구에게 보여 줄지는 파일을 가리키는 모듈이 정한다.
@Injectable()
export class BlobStore {
  private static readonly DEFAULT_DIR = '/data/blobs';
  private readonly dir: string;

  constructor(private readonly db: Database) {
    this.dir = process.env.CAIRN_BLOBS_DIR ?? BlobStore.DEFAULT_DIR;
  }

  /** 저장한다. 내용이 같으면 몇 번을 불러도 파일과 행은 하나다 */
  async save(bytes: Buffer, mime: string): Promise<Blob> {
    const hash = createHash('sha256').update(bytes).digest('hex');
    // 쓰다가 멈춰도 절반만 쓴 파일이 이 이름으로 보이지 않게 임시 파일에 쓰고 이름을 바꾼다
    const temp = await this.tempFile();
    try {
      await writeFile(temp, bytes, { flag: 'wx', flush: true });
      return await this.commit(temp, hash, mime, bytes.length);
    } finally {
      await rm(temp, { force: true });
    }
  }

  /**
   * 흘려 받아 저장한다: 큰 파일도 메모리에 다 올리지 않는다. 받는 동안 크기와 해시를 센다.
   * maxBytes를 넘으면 그 자리에서 멈추고 TooLarge. expectedHash가 있고 내용이 다르면 RuleViolation.
   * 어느 쪽이든 아무것도 남기지 않는다. mime은 파일의 앞부분(FileSniff.HEAD_BYTES)을 보고 mimeOf가 정한다
   */
  async saveStream(
    source: AsyncIterable<Uint8Array>,
    maxBytes: number,
    mimeOf: (head: Buffer) => string,
    expectedHash: string | null = null,
  ): Promise<Blob> {
    const temp = await this.tempFile();
    const digest = createHash('sha256');
    let head = Buffer.alloc(0);
    let size = 0;
    try {
      const file = await open(temp, 'wx');
      try {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxBytes) throw new TooLarge(`파일은 ${maxBytes}바이트까지예요`);
          digest.update(chunk);
          if (head.length < FileSniff.HEAD_BYTES)
            head = Buffer.concat([head, chunk]).subarray(0, FileSniff.HEAD_BYTES);
          await file.write(chunk);
        }
        await file.sync();
      } finally {
        await file.close();
      }
      const hash = digest.digest('hex');
      if (expectedHash !== null && hash !== expectedHash)
        throw new RuleViolation('받은 내용이 알린 해시와 달라요');
      return await this.commit(temp, hash, mimeOf(head), size);
    } finally {
      await rm(temp, { force: true });
    }
  }

  /** 파일을 두는 디스크에 남은 바이트 (root가 아닌 사용자가 쓸 수 있는 만큼) */
  async freeBytes(): Promise<number> {
    await mkdir(this.dir, { recursive: true });
    const stats = await statfs(this.dir);
    return stats.bavail * stats.bsize;
  }

  private async tempFile(): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    return join(this.dir, `.${randomUUID()}.tmp`);
  }

  /** 다 쓴 임시 파일을 해시 이름으로 옮기고 행을 남긴다. 파일이 먼저라 행이 있으면 파일도 있다 */
  private async commit(temp: string, hash: string, mime: string, size: number): Promise<Blob> {
    await rename(temp, join(this.dir, hash));
    await this.db.sql`
      INSERT INTO platform.blobs (hash, mime, size_bytes, storage_key)
      VALUES (${hash}, ${mime}, ${size}, ${hash})
      ON CONFLICT (hash) DO NOTHING`;
    return new Blob(hash, mime, size);
  }

  /** 파일 정보. 없거나 해시 모양이 아니면 null */
  async find(hash: string): Promise<Blob | null> {
    if (!Blob.isHash(hash)) return null;
    const [row] = await this.db.sql`
      SELECT hash, mime, size_bytes FROM platform.blobs WHERE hash = ${hash}`;
    return row ? new Blob(String(row.hash), String(row.mime), Number(row.size_bytes)) : null;
  }

  /** 파일 내용을 읽는다. 없거나 해시 모양이 아니면 NotFound: 이 값이 경로가 되므로 모양을 먼저 본다 */
  async open(hash: string): Promise<Readable> {
    if (!Blob.isHash(hash)) throw new NotFound('파일을 찾을 수 없어요');
    try {
      return (await open(join(this.dir, hash), 'r')).createReadStream();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFound('파일을 찾을 수 없어요');
      throw error;
    }
  }
}
