import type { OutputRow } from '../task.tables';

/** 결과물 하나를 바꾼 뒤 (지우기 · 되살리기 · 올리기). 화면은 이 version으로 다음 변경을 보낸다 */
export class OutputSavedView {
  constructor(private readonly row: Readonly<OutputRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      mime: r.mime,
      sizeBytes: r.size_bytes,
      taskId: r.task_id,
      createdAt: r.created_at.toISOString(),
      deletedAt: r.deleted_at?.toISOString() ?? null,
      purgeAfter: r.purge_after?.toISOString() ?? null,
      version: r.version,
    };
  }
}

/** 결과물 목록의 한 줄: 어느 작업 · 몇 번째 실행이 만들었는지까지 */
export class OutputView extends OutputSavedView {
  constructor(
    row: Readonly<OutputRow>,
    /** 주인이 올린 파일이면 null */
    private readonly taskTitle: string | null,
    private readonly runSeq: number | null,
  ) {
    super(row);
  }

  override toJSON() {
    return { ...super.toJSON(), taskTitle: this.taskTitle, runSeq: this.runSeq };
  }
}

/** 결과물이 쓰는 저장 공간 */
export class OutputUsageView {
  constructor(
    /** 공간의 결과물을 모두 더한 바이트 (휴지통 포함) */
    private readonly usedBytes: number,
    private readonly maxBytes: number,
    private readonly diskFreeBytes: number,
    private readonly reserveBytes: number,
  ) {}

  toJSON() {
    return {
      usedBytes: this.usedBytes,
      maxBytes: this.maxBytes,
      diskFreeBytes: this.diskFreeBytes,
      reserveBytes: this.reserveBytes,
    };
  }
}

/** 결과물 목록 한 쪽 */
export class OutputPageView {
  constructor(
    private readonly outputs: readonly OutputView[],
    /** 다음 쪽을 읽을 때 cursor로 보낸다. 마지막 쪽이면 null */
    private readonly next: string | null,
    private readonly usage: OutputUsageView,
  ) {}

  toJSON() {
    return {
      outputs: this.outputs.map((o) => o.toJSON()),
      next: this.next,
      usage: this.usage.toJSON(),
    };
  }
}

/** begin_upload의 답: 러너가 PUT {서버}{upload_path}에 머리글 x-cairn-upload: token으로 본문을 보낸다 */
export class UploadTicketView {
  constructor(
    private readonly path: string,
    private readonly header: string,
    private readonly token: string,
    private readonly expiresAt: Date,
  ) {}

  toJSON() {
    return {
      upload_path: this.path,
      header: this.header,
      token: this.token,
      expires_at: this.expiresAt.toISOString(),
    };
  }
}

/** begin_download의 답: 재료 결과물을 받을 표와 파일의 이름 · 형식 · 크기 · sha256 (러너가 받은 뒤 맞춰 본다) */
export class DownloadTicketView {
  constructor(
    private readonly path: string,
    private readonly header: string,
    private readonly token: string,
    private readonly expiresAt: Date,
    private readonly row: OutputRow,
  ) {}

  toJSON() {
    return {
      download_path: this.path,
      header: this.header,
      token: this.token,
      expires_at: this.expiresAt.toISOString(),
      name: this.row.name,
      mime: this.row.mime,
      size: this.row.size_bytes,
      sha256: this.row.blob_hash,
    };
  }
}
