import { BaseEntity, type Blob, Conflict, RuleViolation, TableEntity } from '../../platform';
import type { OutputNew, OutputRow } from '../task.tables';
import { OutputPolicy } from './output.policy';
import { OutputSavedView } from './output.view';
import type { UploadTicket } from './upload-ticket';

// 결과물 하나 (task.outputs, 기획서 결정 2026-11-10): AI가 만든 파일을 러너가 일이 끝난 뒤 올린 것.
// 주인이 재료로 쓰려고 올린 파일도 여기에 둔다 (2026-11-13, 작업 · 실행 없음).
// 파일 자체는 platform.blobs에 있고 값으로 가리킨다. 이 줄은 어느 작업 · 실행이 만들었는지와 이름 · 종류를 든다.
// 주인만 지우고(휴지통 30일) 되살린다. 휴지통에서 바로 지우거나 30일이 지나면 줄을 지우고,
// 아무도 쓰지 않게 된 파일은 platform의 BlobSweepJob이 지운다. Cairn 안에 두는 것은 발행이 아니라 결재가 없다.
export class Output extends TableEntity<OutputRow, OutputNew> {
  static readonly TRASH_DAYS = 30;
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;

  /** 올리기 표로 받은 파일. 종류 · 형식은 파일의 앞부분과 이름으로 정한다 */
  static receive(ticket: UploadTicket, blob: Blob, sniffed: string | null, now: Date): Output {
    OutputPolicy.assertName(ticket.name);
    return new Output(
      {
        id: BaseEntity.newId(),
        space_id: ticket.spaceId,
        task_id: ticket.taskId,
        run_id: ticket.runId,
        name: ticket.name,
        kind: OutputPolicy.kindOf(ticket.name, sniffed),
        mime: OutputPolicy.mimeOf(ticket.name, sniffed),
        size_bytes: blob.size,
        blob_hash: blob.hash,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        purge_after: null,
      },
      true,
    );
  }

  /** 주인이 올린 파일 (만들기 일의 재료로 쓰려고). 작업이 만든 것이 아니라 작업 · 실행이 없다 */
  static upload(
    spaceId: string,
    name: string,
    blob: Blob,
    sniffed: string | null,
    now: Date,
  ): Output {
    OutputPolicy.assertName(name);
    return new Output(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        task_id: null,
        run_id: null,
        name,
        kind: OutputPolicy.kindOf(name, sniffed),
        mime: OutputPolicy.mimeOf(name, sniffed),
        size_bytes: blob.size,
        blob_hash: blob.hash,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        purge_after: null,
      },
      true,
    );
  }

  static restore(row: OutputRow): Output {
    return new Output(row);
  }

  get blobHash(): string {
    return this.row.blob_hash;
  }

  /** 같은 실행 · 같은 이름으로 다시 받은 파일이 이 줄과 같은가. 내용이 다르면 409 (응답을 잃고 다시 보낸 것이 아니다) */
  assertSameFile(blobHash: string): void {
    if (blobHash !== this.row.blob_hash)
      throw new Conflict(`이 실행이 이미 다른 내용으로 올린 이름이에요: ${this.row.name}`);
  }

  get name(): string {
    return this.row.name;
  }

  /** 결과 카드에 싣는다 (2차 2단계). 한 번 실린 결과물은 다음 카드에 다시 실리지 않는다 */
  bundleInto(cardId: string): void {
    if (this.row.card_id !== null) throw new RuleViolation('이미 카드에 실린 결과물이에요');
    this.put('card_id', cardId);
  }

  /** 휴지통으로. TRASH_DAYS 뒤 일꾼이 지운다. 이미 휴지통이면 그대로 */
  trash(now: Date): void {
    if (this.row.deleted_at !== null) return;
    this.put('deleted_at', now);
    this.put('purge_after', new Date(now.getTime() + Output.TRASH_DAYS * Output.DAY_MS));
    this.put('updated_at', now);
  }

  /** 휴지통에서 꺼낸다. 휴지통이 아니면 그대로 */
  untrash(now: Date): void {
    if (this.row.deleted_at === null) return;
    this.put('deleted_at', null);
    this.put('purge_after', null);
    this.put('updated_at', now);
  }

  /** 바로 지울 수 있는가: 휴지통에 있는 것만 (실수로 한 번에 지우지 않게) */
  assertPurgeable(): void {
    if (this.row.deleted_at === null)
      throw new RuleViolation('휴지통에 있는 결과물만 바로 지울 수 있어요');
  }

  view(): OutputSavedView {
    return new OutputSavedView(this.row);
  }
}
