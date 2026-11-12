import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import type { Actor } from './actor';
import { Database, type Sql } from './database';
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
//
// 지우기: 모듈은 파일을 값으로만 가리켜(모듈 사이 외래키 없음) DB가 지켜 주지 않는다. 그래서 파일을 가리키는 칸을 가진 모듈이
// 시작할 때 "이 해시들 중 쓰는 것"을 묻는 길을 등록하고(registerUse), sweep은 아무도 쓰지 않는 오래된 파일만 지운다.
// 내용이 같으면 파일이 하나라 여러 모듈이 같은 파일을 쓸 수 있다: 한 모듈이 지웠다고 파일을 지우지 않는다.
// 같은 해시의 저장과 지우기는 advisory 잠금으로 겹치지 않는다. 다시 저장하면 created_at이 새로 되어 기다림이 처음부터다.
@Injectable()
export class BlobStore {
  private static readonly DEFAULT_DIR = '/data/blobs';
  /** sweep이 한 번에 묻는 해시 수 */
  private static readonly SWEEP_BATCH = 500;
  private readonly dir: string;
  /** 칸 이름('<스키마>.<표>.<열>') → 그 칸이 가리키는 해시를 돌려주는 길 */
  private readonly uses = new Map<
    string,
    (actor: Actor, hashes: readonly string[]) => Promise<readonly string[]>
  >();

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

  /**
   * 파일을 값으로 가리키는 칸을 가진 모듈이 onModuleInit에서 등록한다. inUse는 넘긴 해시 중 그 칸들이 가리키는 것을 돌려준다.
   *   blobs.registerUse(['blog.assets.blob_hash'], (actor, hashes) => this.assets.usedBlobs(actor, hashes));
   * 서버 시험(blob-sweep.api.test)이 DB의 *blob_hash 칸이 모두 등록됐는지 본다: 빠뜨리면 그 칸의 파일이 지워진다.
   * 해시를 jsonb 목록 안에 두는 칸은 그 시험에 이름을 따로 적는다
   */
  registerUse(
    columns: readonly string[],
    inUse: (actor: Actor, hashes: readonly string[]) => Promise<readonly string[]>,
  ): void {
    for (const column of columns) {
      if (this.uses.has(column)) throw new Error(`이미 등록된 칸이에요: ${column}`);
      this.uses.set(column, inUse);
    }
  }

  /** 등록된 칸 이름 (시험이 DB와 맞춰 본다) */
  get usedColumns(): readonly string[] {
    return [...this.uses.keys()].sort();
  }

  /**
   * 등록된 어느 칸도 가리키지 않고 olderThan 전에 저장한 파일을 지운다. 지운 수를 돌려준다.
   * 해시 묶음으로 한 번 묻고, 지우기 직전 그 해시의 잠금 안에서 한 번 더 묻는다 (그사이 가리켰을 수 있다).
   * 등록된 칸이 하나도 없으면 지우지 않는다: 모듈이 뜨지 않은 프로세스에서 모든 파일을 지우지 않게
   */
  async sweep(actor: Actor, olderThan: Date): Promise<number> {
    actor.assertOwnerOrSystem();
    if (this.uses.size === 0) return 0;
    let after = '';
    let removed = 0;
    for (;;) {
      const rows = await this.db.sql`
        SELECT hash FROM platform.blobs
         WHERE created_at < ${olderThan} AND hash > ${after}
         ORDER BY hash LIMIT ${BlobStore.SWEEP_BATCH}`;
      const hashes = rows.map((row) => String(row.hash));
      if (hashes.length === 0) return removed;
      after = hashes[hashes.length - 1] as string;
      const used = await this.usedOf(actor, hashes);
      for (const hash of hashes)
        if (!used.has(hash) && (await this.remove(actor, hash, olderThan))) removed++;
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

  /**
   * 다 쓴 임시 파일을 해시 이름으로 옮기고 행을 남긴다. 파일이 먼저라 행이 있으면 파일도 있다.
   * 같은 해시를 지우는 sweep과 겹치지 않게 잠근다 (이름 바꾸기와 행 하나라 트랜잭션은 짧다).
   * 이미 있는 파일이면 created_at을 새로 한다: 지금 다시 쓰려는 파일이 지우기 기다림 끝에 걸리지 않게
   */
  private async commit(temp: string, hash: string, mime: string, size: number): Promise<Blob> {
    await this.db.transaction(async (tx) => {
      await BlobStore.lock(tx, hash);
      await rename(temp, join(this.dir, hash));
      await tx`
        INSERT INTO platform.blobs (hash, mime, size_bytes, storage_key)
        VALUES (${hash}, ${mime}, ${size}, ${hash})
        ON CONFLICT (hash) DO UPDATE SET created_at = now()`;
    });
    return new Blob(hash, mime, size);
  }

  /** 등록된 칸 중 하나라도 가리키는 해시 */
  private async usedOf(actor: Actor, hashes: readonly string[]): Promise<ReadonlySet<string>> {
    const used = new Set<string>();
    for (const inUse of new Set(this.uses.values()))
      for (const hash of await inUse(actor, hashes)) used.add(hash);
    return used;
  }

  /**
   * 잠금 안에서 다시 묻고 행 → 파일 순으로 지운다. 파일은 커밋 전에 지운다: 커밋 뒤에 지우면
   * 그사이 같은 내용을 다시 저장한 파일을 지울 수 있다 (커밋이 실패하면 행만 남고, 같은 내용을 다시 올리면 맞춰진다)
   */
  private remove(actor: Actor, hash: string, olderThan: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await BlobStore.lock(tx, hash);
      if ((await this.usedOf(actor, [hash])).size > 0) return false;
      const gone = await tx`
        DELETE FROM platform.blobs WHERE hash = ${hash} AND created_at < ${olderThan} RETURNING hash`;
      if (gone.length === 0) return false;
      await rm(join(this.dir, hash), { force: true });
      return true;
    });
  }

  private static async lock(tx: Sql, hash: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`platform.blob:${hash}`}, 0))`;
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
