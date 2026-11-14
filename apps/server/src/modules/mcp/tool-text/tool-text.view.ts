import type { ToolTextRevisionRow, ToolTextRow } from '../mcp.tables';

// 콘솔 "도구 설명" 메뉴의 응답 (주인만). 기본 글은 코어 도구의 설명서(<모듈>.tools.ko.json) · 기능 패키지의 목록 파일,
// 콘솔 판은 mcp.tool_text_revisions다. 글은 칸 경로 → 설명 (a · a.b · a[].b).

/** 도구 목록의 한 줄 */
export class ToolTextSummaryView {
  constructor(
    private readonly name: string,
    /** core: 코어 모듈의 도구, plugin: 기능 패키지의 도구 */
    private readonly origin: string,
    /** 지금 쓰는 설명 */
    private readonly description: string,
    /** 콘솔 판을 쓰고 있거나 쌓인 적이 있으면 그 줄 */
    private readonly row: Readonly<ToolTextRow> | null,
    /** 콘솔 판을 쓰는데, 그 판을 만든 뒤 기본 글이 바뀌었는가 (배포로) */
    private readonly defaultChanged: boolean,
  ) {}

  toJSON() {
    const active = this.row?.active_revision ?? null;
    return {
      name: this.name,
      origin: this.origin,
      description: this.description,
      source: active === null ? 'default' : 'console',
      revision: active,
      revisions: this.row?.revisions ?? 0,
      defaultChanged: this.defaultChanged,
      version: this.row?.version ?? 0,
    };
  }
}

export class ToolTextListView {
  constructor(private readonly tools: readonly ToolTextSummaryView[]) {}

  toJSON() {
    return { tools: this.tools.map((t) => t.toJSON()) };
  }
}

/** 판 목록의 한 줄 (글은 싣지 않는다) */
export class ToolTextRevisionItemView {
  constructor(private readonly row: Readonly<ToolTextRevisionRow>) {}

  toJSON() {
    const r = this.row;
    return {
      revision: r.revision,
      basedOn: r.based_on,
      note: r.note,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 판 하나 (글까지) */
export class ToolTextRevisionView {
  constructor(private readonly row: Readonly<ToolTextRevisionRow>) {}

  toJSON() {
    return {
      ...new ToolTextRevisionItemView(this.row).toJSON(),
      description: this.row.description,
      input: this.row.input as Record<string, string>,
    };
  }
}

/**
 * 도구 하나: 지금 쓰는 글, 기본 글, 칸(경로 → 형식), 콘솔 판 목록.
 * version은 다음에 고칠 때 보낸다 (콘솔 판이 아직 없으면 0)
 */
export class ToolTextDetailView {
  constructor(
    private readonly summary: ToolTextSummaryView,
    /** 지금 쓰는 칸 설명 (콘솔 판에 없는 칸은 기본 글) */
    private readonly input: Readonly<Record<string, string>>,
    private readonly defaultDescription: string,
    private readonly defaultInput: Readonly<Record<string, string>>,
    private readonly defaultHash: string,
    /** 칸 경로 → 형식 (string · integer · array …). 화면이 칸마다 입력란을 그린다 */
    private readonly fields: Readonly<Record<string, string>>,
    private readonly revisions: readonly Readonly<ToolTextRevisionRow>[],
  ) {}

  toJSON() {
    return {
      ...this.summary.toJSON(),
      input: this.input,
      fields: Object.entries(this.fields).map(([path, type]) => ({ path, type })),
      default: {
        description: this.defaultDescription,
        input: this.defaultInput,
        hash: this.defaultHash,
      },
      revisionList: this.revisions.map((r) => new ToolTextRevisionItemView(r).toJSON()),
    };
  }
}

/** 판을 쌓거나 쓸 판을 옮긴 뒤 */
export class ToolTextSavedView {
  constructor(private readonly row: Readonly<ToolTextRow>) {}

  toJSON() {
    const r = this.row;
    return {
      name: r.tool,
      source: r.active_revision === null ? 'default' : 'console',
      revision: r.active_revision,
      revisions: r.revisions,
      version: r.version,
    };
  }
}
