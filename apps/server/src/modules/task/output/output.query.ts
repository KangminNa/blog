import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BaseQuery,
  BlobStore,
  Database,
  NotFound,
  RuleViolation,
} from '../../platform';
import { outputs } from '../task.schema';
import type { OutputRow } from '../task.tables';
import type { ListOutputsInput, OutputFileInput } from './output.input';
import { OutputPolicy } from './output.policy';
import { OutputPageView, OutputUsageView, OutputView } from './output.view';

/**
 * 내려줄 결과물 파일 하나. 늘 내려받기(attachment)이고, 미리 보기(inline)는 열어도 되는 형식만이다.
 * 어느 쪽이든 sandbox CSP를 붙인다: 브라우저가 무엇으로 열든 우리 주소의 스크립트로 돌지 않게
 */
export class OutputFile {
  static readonly CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'";

  constructor(
    private readonly name: string,
    readonly mime: string,
    readonly size: number,
    readonly stream: Readable,
    private readonly inline: boolean,
  ) {}

  /** Content-Disposition. 한글 이름은 RFC 5987(filename*)로, 옛 브라우저용 이름은 ASCII만 */
  get disposition(): string {
    const ascii = this.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return `${this.inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(this.name)}`;
  }
}

// 결과물 읽기. 모두 주인만 (write 기기도 안 된다: 작업의 산출물은 비공개 자료일 수 있다).
@Injectable()
export class OutputQuery extends BaseQuery {
  private static readonly PAGE = 50;

  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly policy: OutputPolicy,
  ) {
    super(db);
  }

  /** 결과물 메뉴: 최근부터 한 쪽, 쓰는 저장 공간과 함께 */
  async list(actor: Actor, req: ListOutputsInput): Promise<OutputPageView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const rows = await this.sql<(OutputRow & { task_title: string; run_seq: number })[]>`
      SELECT o.*, t.title AS task_title, r.seq AS run_seq FROM task.outputs o
      JOIN task.tasks t ON t.id = o.task_id
      JOIN task.task_runs r ON r.id = o.run_id
      WHERE o.space_id = ${spaceId}
        AND ${req.trash ? this.sql`o.deleted_at IS NOT NULL` : this.sql`o.deleted_at IS NULL`}
        ${req.kind === null ? this.sql`` : this.sql`AND o.kind = ${req.kind}`}
        ${req.taskId === null ? this.sql`` : this.sql`AND o.task_id = ${req.taskId}`}
        ${req.cursor === null ? this.sql`` : this.sql`AND o.id < ${req.cursor}`}
      ORDER BY o.id DESC
      LIMIT ${OutputQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, OutputQuery.PAGE, (last) => last.id);
    return new OutputPageView(
      items.map((r) => new OutputView(r, r.task_title, r.run_seq)),
      next,
      await this.usage(spaceId),
    );
  }

  /** 파일 하나. 휴지통에 있어도 주인은 받는다 (되살리기 전에 볼 수 있게) */
  async file(actor: Actor, req: OutputFileInput): Promise<OutputFile> {
    actor.assertOwner();
    const row = await this.row(outputs, { space_id: actor.requireSpace(), id: req.id });
    if (!row) throw new NotFound('결과물을 찾을 수 없어요');
    if (req.inline && !OutputPolicy.canInline(row.mime))
      throw new RuleViolation('미리 볼 수 없는 형식이에요. 내려받아 주세요');
    return new OutputFile(
      row.name,
      row.mime,
      row.size_bytes,
      await this.blobs.open(row.blob_hash),
      req.inline,
    );
  }

  /** 넘긴 해시 중 결과물이 가리키는 것 (platform의 BlobStore.sweep이 묻는다. 휴지통의 것도 쓰는 것이다) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<readonly string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql`
      SELECT DISTINCT blob_hash AS hash FROM task.outputs
       WHERE blob_hash = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => String(row.hash));
  }

  private async usage(spaceId: string): Promise<OutputUsageView> {
    const [row] = await this.sql<{ bytes: string | null }[]>`
      SELECT sum(size_bytes) AS bytes FROM task.outputs WHERE space_id = ${spaceId}`;
    return new OutputUsageView(
      Number(row?.bytes ?? 0),
      this.policy.maxBytes,
      await this.blobs.freeBytes(),
      this.policy.reserveBytes,
    );
  }
}
