import { BaseResponse } from '../../platform';
import type { SessionReceipt } from './session';
import type {
  SessionCheckView,
  SessionDetailView,
  SessionHitPageView,
  SessionNoteView,
  SessionPageView,
  SessionRevisionView,
  SessionSummaryView,
} from './session.query';
import { SessionNote } from './session-note';

/** save_session 결과 (AI에게). AI가 사용자에게 보여줄 관리 화면 링크와, 서버가 지운 민감정보 경고를 함께 */
export class SaveSessionResponse extends BaseResponse {
  private constructor(
    private readonly receipt: SessionReceipt,
    private readonly site: string,
  ) {
    super();
  }

  static of(receipt: SessionReceipt, site: string): SaveSessionResponse {
    return new SaveSessionResponse(receipt, site);
  }

  toJSON(): object {
    return {
      status: this.receipt.status,
      session_id: this.receipt.sessionId,
      revision: this.receipt.seq,
      warnings: this.receipt.warnings,
      url: `${this.site}/admin/sessions?session=${this.receipt.sessionId}`,
    };
  }
}

/** check_session 결과 (AI에게). 저장할 때 그대로 쓸 값, 올릴 곳, 저장하면 서버가 지울 것 */
export class SessionCheckResponse extends BaseResponse {
  private constructor(
    private readonly view: SessionCheckView,
    private readonly site: string,
  ) {
    super();
  }

  static of(view: SessionCheckView, site: string): SessionCheckResponse {
    return new SessionCheckResponse(view, site);
  }

  toJSON(): object {
    const v = this.view;
    return {
      ok: true,
      request_id: v.requestId,
      source_session_id: v.sourceSessionId,
      existing: v.sessionId ? { session_id: v.sessionId, revisions: v.revisions } : null,
      warnings: v.redactions,
      site: this.site,
      limits: { section_max: SessionNote.SECTION_MAX, quotes_max: SessionNote.QUOTES_MAX },
    };
  }
}

/** search_sessions 결과 (AI에게). 어떤 세션을 읽을지 고를 만큼만 짧게 */
export class SessionSearchResponse extends BaseResponse {
  private constructor(private readonly page: SessionHitPageView) {
    super();
  }

  static of(page: SessionHitPageView): SessionSearchResponse {
    return new SessionSearchResponse(page);
  }

  toJSON(): object {
    return {
      sessions: this.page.hits.map((h) => ({
        session_id: h.id,
        title: h.title,
        project: h.project,
        tool: h.tool,
        date: h.lastRevisionAt,
        excerpt: h.excerpt.replace(/\s+/g, ' ').trim(),
      })),
      next: this.page.next,
    };
  }
}

/** get_session 결과 (AI에게). 칸은 save_session의 입력과 같은 이름으로, 내용이 있는 칸만 */
export class SessionNoteResponse extends BaseResponse {
  private constructor(private readonly view: SessionNoteView) {
    super();
  }

  static of(view: SessionNoteView): SessionNoteResponse {
    return new SessionNoteResponse(view);
  }

  toJSON(): object {
    const { summary, head } = this.view;
    return {
      session_id: summary.id,
      title: head.note.title,
      project: summary.project,
      tool: summary.tool,
      started_at: summary.startedAt,
      last_revision_at: summary.lastRevisionAt,
      revision: head.seq,
      tags: head.note.tags,
      sections: Object.fromEntries(
        SessionNote.SECTIONS.map(([name]) => [name, head.note.section(name)]).filter(
          ([, text]) => text,
        ),
      ),
    };
  }
}

/** 관리 화면의 세션 목록 한 쪽 */
export class SessionListResponse extends BaseResponse {
  private constructor(private readonly page: SessionPageView) {
    super();
  }

  static of(page: SessionPageView): SessionListResponse {
    return new SessionListResponse(page);
  }

  toJSON(): object {
    return { sessions: this.page.sessions.map(summary), next: this.page.next };
  }
}

/** 관리 화면의 세션 하나: 지금 판 + 판 기록 */
export class SessionDetailResponse extends BaseResponse {
  private constructor(private readonly view: SessionDetailView) {
    super();
  }

  static of(view: SessionDetailView): SessionDetailResponse {
    return new SessionDetailResponse(view);
  }

  toJSON(): object {
    return {
      ...summary(this.view.summary),
      sourceSessionId: this.view.sourceSessionId,
      head: revision(this.view.head),
      history: this.view.history.map((h) => ({
        seq: h.seq,
        kind: h.kind,
        actorType: h.actorType,
        createdAt: h.createdAt,
        redactions: h.redactionCount,
      })),
    };
  }
}

/** 판 하나 (지난 판 보기) */
export class SessionRevisionResponse extends BaseResponse {
  private constructor(private readonly view: SessionRevisionView) {
    super();
  }

  static of(view: SessionRevisionView): SessionRevisionResponse {
    return new SessionRevisionResponse(view);
  }

  toJSON(): object {
    return revision(this.view);
  }
}

function summary(s: SessionSummaryView): object {
  return {
    id: s.id,
    title: s.title,
    project: s.project,
    tool: s.tool,
    deviceId: s.deviceId,
    visibility: s.visibility,
    revisionCount: s.revisionCount,
    startedAt: s.startedAt,
    lastRevisionAt: s.lastRevisionAt,
  };
}

/** 칸은 화면에 보일 순서대로 [이름, 소제목, 글] */
function revision(r: SessionRevisionView): object {
  return {
    seq: r.seq,
    kind: r.kind,
    actorType: r.actorType,
    createdAt: r.createdAt,
    title: r.note.title,
    tags: r.note.tags,
    sections: SessionNote.SECTIONS.map(([name, heading]) => ({
      name,
      heading,
      text: r.note.section(name),
    })),
    warnings: r.note.redactions,
    markdown: r.markdown,
  };
}
