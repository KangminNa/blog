import type { PageRevisionRow, PageRow } from '../blog.tables';

/** 페이지 하나 (콘솔의 페이지 메뉴, 주인) */
export class PageView {
  constructor(private readonly row: PageRow) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      visibility: r.visibility,
      currentSeq: r.current_seq,
      revisions: r.revisions,
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

export class PageListView {
  constructor(private readonly pages: readonly PageView[]) {}

  toJSON() {
    return { pages: this.pages.map((p) => p.toJSON()) };
  }
}

/** 방문자가 보는 공개 페이지 한 줄: 이름과 제목뿐 (판 · 만든 작업은 내보내지 않는다) */
export class PublicPageView {
  constructor(private readonly row: Pick<PageRow, 'name' | 'title' | 'updated_at'>) {}

  toJSON() {
    return {
      name: this.row.name,
      title: this.row.title,
      updatedAt: this.row.updated_at.toISOString(),
    };
  }
}

export class PublicPageListView {
  constructor(private readonly pages: readonly PublicPageView[]) {}

  toJSON() {
    return { pages: this.pages.map((p) => p.toJSON()) };
  }
}

/** 판 한 줄: 언제 · 어떤 요청으로 · 어느 작업이 만들었나 */
export class PageRevisionView {
  constructor(
    private readonly row: PageRevisionRow,
    private readonly files: readonly { readonly name: string; readonly sizeBytes: number }[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      note: r.note,
      taskId: r.task_id,
      runId: r.run_id,
      files: this.files.map((f) => ({ name: f.name, sizeBytes: f.sizeBytes })),
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 페이지 하나와 판 목록 (새 판부터) */
export class PageDetailView {
  constructor(
    private readonly page: PageView,
    private readonly revisions: readonly PageRevisionView[],
  ) {}

  toJSON() {
    return { ...this.page.toJSON(), revisionList: this.revisions.map((r) => r.toJSON()) };
  }
}
