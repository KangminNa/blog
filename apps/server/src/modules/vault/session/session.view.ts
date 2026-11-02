import type { SessionRevisionRow, SessionRow } from '../vault.tables';

// 세션의 읽기 모양. 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.
// AI에게 주는 답은 snake_case, 관리 화면의 답은 camelCase다.

/** 판의 노트를 읽는 모양. SessionNote가 채운다 (view 파일은 표 인터페이스만 가져온다) */
export interface SessionNoteContent {
  readonly title: string;
  readonly tags: readonly string[];
  readonly redactions: readonly object[];
  /** 칸마다 이름, 소제목, 글. 화면에 보일 순서대로 */
  headedSections(): readonly { name: string; heading: string; text: string }[];
  /** 내용이 있는 칸만 이름 → 글. 이름은 save_session의 입력과 같다 */
  filledSections(): Readonly<Record<string, string>>;
}

/** 찾은 세션 한 줄을 읽는 칸 */
export interface SessionHitRow
  extends Pick<SessionRow, 'node_id' | 'head_title' | 'project' | 'tool' | 'last_revision_at'> {
  excerpt: string | null;
}

/** 판 기록의 한 줄을 읽는 칸 (내용 없이). redactions는 지운 수다 */
export interface RevisionStampRow
  extends Pick<SessionRevisionRow, 'seq' | 'kind' | 'actor_type' | 'created_at'> {
  redactions: number;
}

/** 이 대화로 이미 저장한 세션과 그 판 수 */
export interface SessionCheckRow extends Pick<SessionRow, 'node_id'> {
  revisions: number;
}

/** save_session 결과 (AI에게). AI가 사용자에게 보여줄 관리 화면 링크와, 서버가 지운 민감정보 경고를 함께 */
export class SessionSavedView {
  constructor(
    private readonly status: string,
    private readonly sessionId: string,
    private readonly seq: number,
    private readonly warnings: readonly object[],
    private readonly site: string,
  ) {}

  toJSON() {
    return {
      status: this.status,
      session_id: this.sessionId,
      revision: this.seq,
      warnings: this.warnings,
      url: `${this.site}/admin/sessions?session=${this.sessionId}`,
    };
  }
}

/** check_session 결과 (AI에게). 저장할 때 그대로 쓸 값, 올릴 곳, 저장하면 서버가 지울 것 */
export class SessionCheckView {
  constructor(
    private readonly requestId: string,
    private readonly sourceSessionId: string,
    private readonly found: Readonly<SessionCheckRow> | null,
    private readonly redactions: readonly object[],
    private readonly site: string,
    private readonly limits: Readonly<Record<string, number>>,
  ) {}

  toJSON() {
    const { found } = this;
    return {
      ok: true,
      request_id: this.requestId,
      source_session_id: this.sourceSessionId,
      existing: found ? { session_id: found.node_id, revisions: found.revisions } : null,
      warnings: this.redactions,
      site: this.site,
      limits: this.limits,
    };
  }
}

/** 세션 목록의 한 줄. 기기는 id만 (기기 이름은 account 모듈의 것이라 화면이 기기 목록과 맞춘다) */
export class SessionSummaryView {
  constructor(private readonly row: Readonly<SessionRow>) {}

  get title(): string {
    return this.row.head_title ?? '';
  }

  toJSON() {
    const r = this.row;
    return {
      id: r.node_id,
      title: this.title,
      project: r.project,
      tool: r.tool,
      deviceId: r.device_id,
      visibility: r.visibility,
      revisionCount: r.revision_count,
      startedAt: r.started_at?.toISOString() ?? null,
      lastRevisionAt: r.last_revision_at?.toISOString() ?? null,
    };
  }
}

/** 관리 화면의 세션 목록 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class SessionPageView {
  constructor(
    private readonly sessions: readonly SessionSummaryView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { sessions: this.sessions.map((s) => s.toJSON()), next: this.next };
  }
}

/** 찾은 세션 한 줄. 본문 조각은 찾은 말 둘레 (본문에 없고 제목에만 있으면 본문 앞부분) */
export class SessionHitView {
  constructor(private readonly row: Readonly<SessionHitRow>) {}

  toJSON() {
    const r = this.row;
    return {
      session_id: r.node_id,
      title: r.head_title ?? '',
      project: r.project,
      tool: r.tool,
      date: r.last_revision_at?.toISOString() ?? null,
      excerpt: (r.excerpt ?? '').replace(/\s+/g, ' ').trim(),
    };
  }
}

/** search_sessions 결과 (AI에게). 어떤 세션을 읽을지 고를 만큼만 짧게. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class SessionHitPageView {
  constructor(
    private readonly hits: readonly SessionHitView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { sessions: this.hits.map((h) => h.toJSON()), next: this.next };
  }
}

/** 판 하나 (지난 판 보기). 칸은 화면에 보일 순서대로 [이름, 소제목, 글] */
export class SessionRevisionView {
  constructor(
    private readonly row: Readonly<SessionRevisionRow>,
    private readonly note: SessionNoteContent,
  ) {}

  toJSON() {
    const { row: r, note } = this;
    return {
      seq: r.seq,
      kind: r.kind,
      actorType: r.actor_type,
      createdAt: r.created_at.toISOString(),
      title: note.title,
      tags: note.tags,
      sections: note.headedSections(),
      warnings: note.redactions,
      markdown: r.body_md,
    };
  }
}

/** 판 기록의 한 줄 (내용 없이) */
export class RevisionStampView {
  constructor(private readonly row: Readonly<RevisionStampRow>) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      kind: r.kind,
      actorType: r.actor_type,
      createdAt: r.created_at.toISOString(),
      redactions: r.redactions,
    };
  }
}

/** 관리 화면의 세션 하나: 목록 정보 + 지금 판 + 판 기록 */
export class SessionDetailView {
  constructor(
    private readonly row: Readonly<SessionRow>,
    private readonly head: SessionRevisionView,
    private readonly history: readonly RevisionStampView[],
  ) {}

  toJSON() {
    return {
      ...new SessionSummaryView(this.row).toJSON(),
      sourceSessionId: this.row.source_session_id,
      head: this.head.toJSON(),
      history: this.history.map((h) => h.toJSON()),
    };
  }
}

/** get_session 결과 (AI에게): 목록 정보 + 지금 판. 칸은 save_session의 입력과 같은 이름으로, 내용이 있는 칸만 */
export class SessionNoteView {
  readonly summary: SessionSummaryView;

  constructor(
    private readonly row: Readonly<SessionRow>,
    private readonly head: Readonly<SessionRevisionRow>,
    private readonly note: SessionNoteContent,
  ) {
    this.summary = new SessionSummaryView(row);
  }

  toJSON() {
    const r = this.row;
    return {
      session_id: r.node_id,
      title: this.note.title,
      project: r.project,
      tool: r.tool,
      started_at: r.started_at?.toISOString() ?? null,
      last_revision_at: r.last_revision_at?.toISOString() ?? null,
      revision: this.head.seq,
      tags: this.note.tags,
      sections: this.note.filledSections(),
    };
  }
}
