import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import { BlobStore } from '../base/blob-store';
import { Database, type Sql } from '../base/database';
import { RuleViolation, TooLarge } from '../base/errors';
import { ZipLimits } from '../base/zip-reader';
import { ArchiveQuery } from './archive.query';
import type { ArchiveFile } from './archive-file';
import { type ArchivePart, ArchiveReport } from './archive-part';

// 보관 파일 묶음을 빈 Cairn에 들여온다 (docs/보관형식.md). GitHub와 zip이 같은 길을 쓴다: 둘 다 ArchiveFile 목록이 된다.
// 순서: 형식 검사 → 각 모듈이 전부 읽어 검사 → 개수 → (적용이면) 파일 → 트랜잭션 하나.
// 읽기에서 실패하면 아무것도 쓰지 않는다. 파일은 내용 주소라 트랜잭션 밖에서 먼저 쓴다: 다시 해도 그대로다.
// 트랜잭션 하나로 모듈을 묶어, 실패하면 Cairn은 비어 있는 채로 남는다. 모듈은 자기 스키마에만 쓴다.
@Injectable()
export class ArchiveRestoreService extends BaseService {
  private static readonly LOCK = 'platform.archive.restore';
  private static readonly UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  constructor(
    db: Database,
    private readonly archive: ArchiveQuery,
    private readonly blobs: BlobStore,
  ) {
    super(db);
  }

  /** 검사만 한다. 아무것도 쓰지 않는다 */
  async preview(actor: Actor, files: readonly ArchiveFile[]): Promise<ArchiveReport> {
    ArchiveRestoreService.assertAllowed(actor);
    const parts = this.read(files);
    await this.transaction((tx) => ArchiveRestoreService.assertEmpty(tx, parts));
    return ArchiveRestoreService.report(parts, []);
  }

  /** 정말 들여온다. spaceId: 들여올 공간. 없으면 설치부터 */
  async apply(
    actor: Actor,
    spaceId: string | null,
    files: readonly ArchiveFile[],
  ): Promise<ArchiveReport> {
    ArchiveRestoreService.assertAllowed(actor);
    if (spaceId === null || !ArchiveRestoreService.UUID.test(spaceId))
      throw new RuleViolation('설치를 마친 뒤에 복원할 수 있어요 (pnpm install-code)');
    const parts = this.read(files);
    await this.transaction((tx) => ArchiveRestoreService.assertEmpty(tx, parts));
    for (const part of parts) for (const blob of part.blobs) await blob.saveTo(this.blobs);
    const notes = await this.transaction(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ArchiveRestoreService.LOCK}, 0))`;
      await ArchiveRestoreService.assertEmpty(tx, parts);
      const written: string[] = [];
      for (const part of parts) written.push(...(await part.write(tx, spaceId)));
      return written;
    });
    return ArchiveRestoreService.report(parts, notes);
  }

  /**
   * 복원과 겹치지 않게 읽는다. 복원 중이면 끝나기를 기다리고, 읽는 동안에는 복원이 시작되지 못한다.
   * 내보내기는 쿼리 여러 개라, 사이에 복원이 커밋되면 절반만 있는 모습이 나오고 동기화가 나머지를 지운다.
   */
  steadyRead<T>(read: () => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock_shared(hashtextextended(${ArchiveRestoreService.LOCK}, 0))`;
      return read();
    });
  }

  /** 주인과 서버 자신만: write 권한을 가진 기기가 동작 경로로 복원하지 못하게 */
  private static assertAllowed(actor: Actor): void {
    if (actor.kind !== 'system') actor.assertOwner();
  }

  private read(files: readonly ArchiveFile[]): readonly ArchivePart[] {
    ArchiveRestoreService.assertFormat(files);
    const parts = this.archive.restoreSteps().map((read) => read(files));
    if (parts.every((part) => part.counts.size === 0))
      throw new RuleViolation('들여올 내용이 없어요');
    return parts;
  }

  /** 형식 검사. 크기 한도는 zip이 아닌 길(GitHub)에도 똑같이 건다 */
  private static assertFormat(files: readonly ArchiveFile[]): void {
    const limits = ZipLimits.DEFAULT;
    if (files.length > limits.maxEntries)
      throw new TooLarge(`보관 파일이 너무 많아요 (${limits.maxEntries}개까지)`);
    if (files.reduce((sum, f) => sum + f.body.length, 0) > limits.maxBytes)
      throw new TooLarge('보관 파일이 너무 커요');
    const paths = new Set<string>();
    for (const { path } of files) {
      if (paths.has(path)) throw new RuleViolation(`같은 경로가 두 번 있어요: ${path}`);
      paths.add(path);
    }
    const head = files.find((f) => f.path === 'cairn.json');
    if (!head) throw new RuleViolation('보관 파일이 아니에요: cairn.json이 없어요');
    const format = ArchiveRestoreService.formatOf(head);
    if (format > ArchiveQuery.FORMAT)
      throw new RuleViolation(
        `더 새로운 형식이에요 (형식 ${format}, 이 Cairn은 ${ArchiveQuery.FORMAT}까지). Cairn을 올린 뒤 복원해 주세요`,
      );
  }

  private static formatOf(head: ArchiveFile): number {
    let parsed: unknown;
    try {
      parsed = JSON.parse(head.asText());
    } catch {
      throw new RuleViolation('cairn.json을 읽을 수 없어요');
    }
    const format = (parsed as { format?: unknown } | null)?.format;
    if (!Number.isInteger(format) || (format as number) < 1)
      throw new RuleViolation('cairn.json의 format이 틀렸어요');
    return format as number;
  }

  private static async assertEmpty(tx: Sql, parts: readonly ArchivePart[]): Promise<void> {
    const found = new Map<string, number>();
    for (const part of parts)
      for (const [name, count] of await part.existing(tx)) found.set(name, count);
    if (found.size > 0)
      throw new RuleViolation(
        `빈 Cairn에만 복원할 수 있어요. 지금 ${ArchiveReport.describe(found)}가 있어요`,
      );
  }

  private static report(parts: readonly ArchivePart[], notes: readonly string[]): ArchiveReport {
    return new ArchiveReport(new Map(parts.flatMap((part) => [...part.counts])), [
      ...parts.flatMap((part) => part.notes),
      ...notes,
    ]);
  }
}
