import type { Blob, BlobStore } from '../base/blob-store';
import type { Sql } from '../base/database';
import { RuleViolation } from '../base/errors';
import type { ArchiveFile } from './archive-file';
import { ArchiveRecord } from './archive-record';

/** 복원할 때 트랜잭션 전에 쓰는 파일 하나. 내용 주소라 다시 써도 그대로다 */
export class ArchiveBlob {
  constructor(
    private readonly bytes: Buffer,
    private readonly mime: string,
  ) {}

  saveTo(store: BlobStore): Promise<Blob> {
    return store.save(this.bytes, this.mime);
  }
}

/** 미리 보기와 복원의 결과: 무엇이 몇 개, 그리고 알아 둘 것 */
export class ArchiveReport {
  constructor(
    readonly counts: ReadonlyMap<string, number>,
    readonly notes: readonly string[],
  ) {}

  /** "세션 3개 · wiki 2개" */
  get summary(): string {
    return ArchiveReport.describe(this.counts);
  }

  static describe(counts: ReadonlyMap<string, number>): string {
    return [...counts].map(([name, count]) => `${name} ${count}개`).join(' · ');
  }
}

// 복원에서 모듈 하나가 맡는 몫. 모듈이 `ArchiveQuery.registerRestore`로 보관 파일을 이것으로 읽는 방법을 등록한다.
// 만들어졌다면 검사를 통과한 것이다: 읽기는 쓰기 전에 끝나고, 읽다가 실패하면 아무것도 쓰지 않는다.
export abstract class ArchivePart {
  /** 들어올 것의 이름 → 개수 (미리 보기) */
  abstract readonly counts: ReadonlyMap<string, number>;

  /** 미리 보기에 함께 보일 알림 */
  get notes(): readonly string[] {
    return [];
  }

  /** 트랜잭션 전에 쓸 파일들 */
  get blobs(): readonly ArchiveBlob[] {
    return [];
  }

  /** 이 모듈에 이미 있는 것 (이름 → 개수). 테이블을 잠그고 세므로 끝날 때까지 새 행이 끼어들지 못한다 */
  abstract existing(tx: Sql): Promise<ReadonlyMap<string, number>>;

  /** 자기 스키마에만 쓴다. 이벤트는 남기지 않는다. 돌려준 글은 복원 결과의 알림이 된다 */
  abstract write(tx: Sql, spaceId: string): Promise<readonly string[]>;

  /** md 보관 파일 하나를 읽는다. 종류와 형식 버전을 함께 본다 */
  protected static document(file: ArchiveFile, type: string, format: number): ArchiveRecord {
    const record = ArchiveRecord.ofMarkdown(file.path, ArchivePart.textOf(file));
    if (record.text('cairn_type') !== type)
      throw record.problem(`종류가 ${type}이어야 해요: ${record.text('cairn_type')}`);
    if (record.number('cairn_format') > format)
      throw record.problem(`더 새로운 형식이에요 (${record.number('cairn_format')})`);
    return record;
  }

  /** 글자로 된 보관 파일. 깨진 글자를 조용히 바꾸지 않는다 */
  protected static textOf(file: ArchiveFile): string {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.body);
    } catch {
      throw new RuleViolation(`${file.path}: UTF-8 글자가 아니에요`);
    }
  }

  /** 겹치면 멈춘다 (id, 주소). DB의 유일 제약에 걸리기 전에 무엇이 겹쳤는지 알려 준다 */
  protected static assertUnique(values: readonly string[], what: string): void {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) throw new RuleViolation(`${what}이(가) 겹쳐요: ${value}`);
      seen.add(value);
    }
  }

  /** 없는 값은 세지 않는다 (0개인 것을 "있다"고 말하지 않게) */
  protected static present(
    counts: ReadonlyArray<readonly [string, number]>,
  ): ReadonlyMap<string, number> {
    return new Map(counts.filter(([, count]) => count > 0));
  }
}
