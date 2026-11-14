import type { SessionRevisionRow, SessionRow, SessionTranscriptRow } from '../vault.tables';

// 세션의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다. 관리 화면(REST)은 camelCase, AI 도구(MCP)의 답은 snake_case다.

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

/** 민감정보를 지운 자리 하나. 값은 남기지 않고 어느 칸에서 무엇을 지웠는지만 */
export class RedactionView {
  constructor(
    private readonly kind: string,
    private readonly section: string,
    private readonly label: string,
  ) {}

  toJSON() {
    return { kind: this.kind, section: this.section, label: this.label };
  }
}

/** 노트의 칸 하나: 칸 이름, 소제목, 글 */
export class SessionSectionView {
  constructor(
    private readonly name: string,
    private readonly heading: string,
    private readonly text: string,
  ) {}

  toJSON() {
    return { name: this.name, heading: this.heading, text: this.text };
  }
}

/** save_session의 답 (AI에게). AI가 사용자에게 보여줄 관리 화면 링크와, 서버가 지운 민감정보 경고를 함께 */
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

/**
 * save_transcript · save_note의 답 (수집 훅 · 확장 · 서버 러너에게). saved · unchanged · duplicate · skipped.
 * 원문이면 seq는 원문의 번호, 노트면 판의 번호. 모으지 않는 프로젝트의 원문은 세션이 없다 (session_id null)
 */
export class TranscriptSavedView {
  constructor(
    private readonly status: string,
    private readonly sessionId: string | null,
    private readonly seq: number,
    private readonly warnings: readonly object[],
  ) {}

  toJSON() {
    return {
      status: this.status,
      session_id: this.sessionId,
      seq: this.seq,
      warnings: this.warnings,
    };
  }
}

/** check_session의 답 (AI에게). 저장할 때 그대로 쓸 값, 올릴 곳, 저장하면 서버가 지울 것 */
export class SessionCheckView {
  constructor(
    private readonly requestId: string,
    private readonly sourceSessionId: string,
    /** 이 대화로 이미 저장한 세션 */
    private readonly found: Readonly<SessionCheckRow> | null,
    private readonly redactions: readonly RedactionView[],
    private readonly site: string,
    /** 칸 하나와 인용의 글자 수 상한 */
    private readonly limits: readonly [number, number],
  ) {}

  toJSON() {
    const { found, limits } = this;
    return {
      ok: true,
      request_id: this.requestId,
      source_session_id: this.sourceSessionId,
      existing: found ? { session_id: found.node_id, revisions: found.revisions } : null,
      warnings: this.redactions.map((r) => r.toJSON()),
      site: this.site,
      limits: { section_max: limits[0], quotes_max: limits[1] },
    };
  }
}

/** 세션 목록의 한 줄. 기기는 id만 (기기 이름은 account 모듈의 것이라 화면이 기기 목록과 맞춘다) */
export class SessionSummaryView {
  constructor(private readonly row: Readonly<SessionRow>) {}

  /** 제목 (지금 판의 제목). 소재 담기가 읽는다 */
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
      transcriptCount: r.transcript_count,
      startedAt: r.started_at?.toISOString() ?? null,
      lastRevisionAt: r.last_revision_at?.toISOString() ?? null,
    };
  }
}

/** 목록 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class SessionPageView {
  constructor(
    private readonly sessions: readonly SessionSummaryView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { sessions: this.sessions.map((s) => s.toJSON()), next: this.next };
  }
}

/** 찾은 세션 한 줄 (AI에게). 본문 조각은 찾은 말 둘레 (본문에 없고 제목에만 있으면 본문 앞부분) */
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

/** search_sessions의 답 (AI에게). 어떤 세션을 읽을지 고를 만큼만 짧게 */
export class SessionHitPageView {
  constructor(
    private readonly hits: readonly SessionHitView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { sessions: this.hits.map((h) => h.toJSON()), next: this.next };
  }
}

/** 판 하나의 내용. 제목 · 태그 · 칸은 판의 노트(sections 칸)에서 읽은 것이고, 칸은 화면에 보일 순서대로 */
export class SessionRevisionView {
  constructor(
    private readonly row: Readonly<SessionRevisionRow>,
    private readonly title: string,
    private readonly tags: readonly string[],
    private readonly sections: readonly SessionSectionView[],
    private readonly warnings: readonly RedactionView[],
  ) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      kind: r.kind,
      actorType: r.actor_type,
      createdAt: r.created_at.toISOString(),
      title: this.title,
      tags: [...this.tags],
      sections: this.sections.map((s) => s.toJSON()),
      warnings: this.warnings.map((w) => w.toJSON()),
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

/** 세션 하나: 목록 정보 + 지금 판 + 판 기록 */
export class SessionDetailView {
  constructor(
    private readonly row: Readonly<SessionRow>,
    /** 원문만 있고 노트가 아직 없으면 null */
    private readonly head: SessionRevisionView | null,
    private readonly history: readonly RevisionStampView[],
    private readonly transcripts: readonly TranscriptStampView[],
  ) {}

  toJSON() {
    return {
      ...new SessionSummaryView(this.row).toJSON(),
      sourceSessionId: this.row.source_session_id,
      head: this.head?.toJSON() ?? null,
      history: this.history.map((h) => h.toJSON()),
      transcripts: this.transcripts.map((t) => t.toJSON()),
    };
  }
}

/** 원문 기록의 한 줄 (내용 없이): 번호, 글자 수, 지운 민감정보 수 */
export interface TranscriptStampRow extends Pick<SessionTranscriptRow, 'seq' | 'created_at'> {
  chars: number;
  redactions: number;
}

export class TranscriptStampView {
  constructor(private readonly row: Readonly<TranscriptStampRow>) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      chars: r.chars,
      redactions: r.redactions,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 원문 하나 (관리 화면) */
export class TranscriptView {
  constructor(private readonly row: Readonly<SessionTranscriptRow>) {}

  toJSON() {
    const r = this.row;
    return {
      seq: r.seq,
      text: r.text,
      actorType: r.actor_type,
      createdAt: r.created_at.toISOString(),
    };
  }
}

/** 세션 노트 일의 원문 (서버 러너가 읽는다): 세션의 머리와 원문 하나 */
export interface TranscriptJobRow
  extends Pick<SessionRow, 'node_id' | 'tool' | 'project' | 'head_title' | 'started_at'>,
    Pick<SessionTranscriptRow, 'seq' | 'text'> {}

/** read_transcript의 답 (서버 러너에게). text는 AI에게 줄 만큼 가운데를 줄인 원문 */
export class TranscriptJobView {
  constructor(
    private readonly row: Readonly<TranscriptJobRow>,
    private readonly text: string,
  ) {}

  toJSON() {
    const r = this.row;
    return {
      session_id: r.node_id,
      seq: r.seq,
      tool: r.tool,
      project: r.project,
      title: r.head_title,
      started_at: r.started_at?.toISOString() ?? null,
      text: this.text,
    };
  }
}

/** get_session의 답 (AI에게): 목록 정보 + 지금 판. 칸은 save_session의 입력과 같은 이름으로, 내용이 있는 칸만 */
export class SessionNoteView {
  readonly summary: SessionSummaryView;

  constructor(
    private readonly row: Readonly<SessionRow>,
    private readonly head: SessionRevisionView,
  ) {
    this.summary = new SessionSummaryView(row);
  }

  toJSON() {
    const r = this.row;
    const head = this.head.toJSON();
    return {
      session_id: r.node_id,
      title: head.title,
      project: r.project,
      tool: r.tool,
      started_at: r.started_at?.toISOString() ?? null,
      last_revision_at: r.last_revision_at?.toISOString() ?? null,
      revision: head.seq,
      tags: head.tags,
      // 칸 순서 그대로
      sections: Object.fromEntries(
        head.sections.filter((s) => s.text).map((s) => [s.name, s.text]),
      ),
    };
  }
}
