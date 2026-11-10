import { Injectable } from '@nestjs/common';
import {
  type Actor,
  BlobStore,
  Database,
  EntityService,
  FileSniff,
  RuleViolation,
  SecretBox,
  type Sql,
  TooLarge,
} from '../../platform';
import { TaskQuery } from '../task/task.query';
import { Output } from './output';
import type { BeginUploadInput, OutputActionInput } from './output.input';
import { OutputPolicy } from './output.policy';
import { OutputRepository } from './output.repository';
import { UploadTicketView } from './output.view';
import { UploadTicket } from './upload-ticket';

// 결과물 쓰기 (기획서 결정 2026-11-10).
//   러너: begin_upload로 표를 받고(임대를 쥔 실행만, 한도 미리 보기) → PUT api/outputs/upload로 본문을 흘려 보낸다
//   받기: 표를 열고 → 트랜잭션 밖에서 파일을 저장하며 크기 · 해시를 확인하고 → 짧은 트랜잭션에서 한도를 다시 세고 줄 하나
//   주인: 휴지통으로 · 되살리기 · 휴지통에서 바로 지우기. 일꾼: 30일 지난 휴지통 비우기
// AI가 직접 올리지 않는다: 바이트와 한도는 러너가 맡는다 (파일이 base64로 AI의 맥락에 들어가지 않게, push와 같은 이유).
@Injectable()
export class OutputService extends EntityService<Output> {
  constructor(
    db: Database,
    private readonly blobs: BlobStore,
    private readonly box: SecretBox,
    private readonly policy: OutputPolicy,
    private readonly tasks: TaskQuery,
  ) {
    super(db);
  }

  protected store(tx: Sql): OutputRepository {
    return new OutputRepository(tx);
  }

  /** 러너: 올리기 표. 임대를 쥔 이번 실행이어야 하고, 이름 · 한도를 미리 본다 (받을 때 다시 센다) */
  async beginUpload(actor: Actor, req: BeginUploadInput): Promise<UploadTicketView> {
    const run = await this.tasks.heldRun(actor, req.taskId);
    OutputPolicy.assertName(req.name);
    const now = new Date();
    const ticket = new UploadTicket(
      run.space_id,
      run.task_id,
      run.id,
      req.name,
      req.size,
      req.sha256,
    );
    await this.assertRoom(new OutputRepository(this.db.sql), ticket);
    return new UploadTicketView(
      UploadTicket.PATH,
      UploadTicket.HEADER,
      ticket.seal(this.box, now),
      UploadTicket.expiresAt(now),
    );
  }

  /**
   * 표로 본문을 받는다. 같은 표로 다시 보내면 같은 줄 (응답을 잃은 러너).
   * 본문이 표의 크기를 넘으면 413, 크기 · 해시가 다르면 422: 파일도 줄도 남기지 않는다.
   * 한도를 넘어 줄을 만들지 못하면 받은 파일은 아무도 쓰지 않는 파일로 남아 BlobSweepJob이 지운다
   */
  async receive(
    token: string | null,
    body: AsyncIterable<Uint8Array>,
    contentLength: number | null,
  ): Promise<Output> {
    const now = new Date();
    const ticket = UploadTicket.open(this.box, token, now);
    if (contentLength !== null && contentLength > ticket.size)
      throw new TooLarge(`표에 적은 크기(${ticket.size}바이트)보다 큰 본문이에요`);
    if (contentLength !== null && contentLength < ticket.size)
      throw new RuleViolation(`표에 적은 크기(${ticket.size}바이트)보다 작은 본문이에요`);
    const before = await new OutputRepository(this.db.sql).findInRun(ticket.runId, ticket.name);
    if (before) {
      before.assertSameFile(ticket.sha256);
      return before;
    }
    await this.assertRoom(new OutputRepository(this.db.sql), ticket);
    let sniffed: string | null = null;
    const blob = await this.blobs.saveStream(
      body,
      ticket.size,
      (head) => {
        sniffed = FileSniff.mimeOf(head);
        return OutputPolicy.mimeOf(ticket.name, sniffed);
      },
      ticket.sha256,
    );
    if (blob.size !== ticket.size)
      throw new RuleViolation(`표에 적은 크기(${ticket.size}바이트)와 받은 크기가 달라요`);
    const freeBytes = await this.blobs.freeBytes();
    return this.transaction(async (tx) => {
      const store = new OutputRepository(tx);
      await store.lockSpace(ticket.spaceId);
      const again = await store.findInRun(ticket.runId, ticket.name);
      if (again) {
        again.assertSameFile(blob.hash);
        return again;
      }
      const [files, bytes] = await store.runTotals(ticket.runId);
      OutputPolicy.assertRun(files, bytes, blob.size);
      // 파일은 이미 디스크에 있으니 디스크 여유는 그 크기를 빼지 않고 본다
      this.policy.assertRoom(
        await store.usedBytes(ticket.spaceId),
        freeBytes + blob.size,
        blob.size,
      );
      const output = Output.receive(ticket, blob, sniffed, now);
      await store.save(output);
      return output;
    });
  }

  /** 휴지통으로 (30일 뒤 일꾼이 지운다) */
  trash(actor: Actor, req: OutputActionInput): Promise<Output> {
    return this.changeAsOwner(actor, req, (output) => output.trash(new Date()));
  }

  /** 휴지통에서 꺼낸다 */
  untrash(actor: Actor, req: OutputActionInput): Promise<Output> {
    return this.changeAsOwner(actor, req, (output) => output.untrash(new Date()));
  }

  /** 휴지통에서 바로 지운다. 파일은 아무도 쓰지 않게 되면 BlobSweepJob이 7일 뒤 지운다 */
  async purge(actor: Actor, req: OutputActionInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const store = new OutputRepository(tx);
      const output = await store.lock(spaceId, req.id);
      output.assertVersion(req.version);
      output.assertPurgeable();
      await store.remove(output);
    });
  }

  /** 일꾼: 휴지통 기간이 지난 결과물을 지운다. 지운 수 */
  purgeExpired(actor: Actor, now: Date): Promise<number> {
    actor.assertOwnerOrSystem();
    return this.transaction((tx) => new OutputRepository(tx).purgeExpired(now));
  }

  /** 실행 한 번 · 공간 · 디스크 한도에 이 파일이 들어가는가 (잠그지 않고 미리 본다) */
  private async assertRoom(store: OutputRepository, ticket: UploadTicket): Promise<void> {
    const [files, bytes] = await store.runTotals(ticket.runId);
    OutputPolicy.assertRun(files, bytes, ticket.size);
    this.policy.assertRoom(
      await store.usedBytes(ticket.spaceId),
      await this.blobs.freeBytes(),
      ticket.size,
    );
  }
}
