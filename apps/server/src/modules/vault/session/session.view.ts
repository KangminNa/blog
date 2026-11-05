// 세션의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).
// toJSON은 관리 화면(REST)의 모양이다. AI 도구(MCP)의 snake_case 모양은 session.tool.ts의 응답이 만든다.

/** 민감정보를 지운 자리 하나. 값은 남기지 않고 어느 칸에서 무엇을 지웠는지만 */
export class RedactionView {
  constructor(
    readonly kind: string,
    readonly section: string,
    readonly label: string,
  ) {}

  toJSON() {
    return { kind: this.kind, section: this.section, label: this.label };
  }
}

/** 노트의 칸 하나: 칸 이름, 소제목, 글 */
export class SessionSectionView {
  constructor(
    readonly name: string,
    readonly heading: string,
    readonly text: string,
  ) {}

  toJSON() {
    return { name: this.name, heading: this.heading, text: this.text };
  }
}

/** 저장 전 검사 결과: 저장할 때 쓸 값, 이 대화로 이미 저장한 세션, 저장하면 서버가 지울 것 */
export class SessionCheckView {
  constructor(
    readonly requestId: string,
    readonly sourceSessionId: string,
    readonly sessionId: string | null,
    readonly revisions: number,
    readonly redactions: readonly RedactionView[],
  ) {}
}

/** 세션 목록의 한 줄. 기기는 id만 (기기 이름은 account 모듈의 것이라 화면이 기기 목록과 맞춘다) */
export class SessionSummaryView {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly project: string | null,
    readonly tool: string,
    readonly deviceId: string,
    readonly visibility: string,
    readonly revisionCount: number,
    readonly startedAt: Date | null,
    readonly lastRevisionAt: Date | null,
  ) {}

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      project: this.project,
      tool: this.tool,
      deviceId: this.deviceId,
      visibility: this.visibility,
      revisionCount: this.revisionCount,
      startedAt: this.startedAt?.toISOString() ?? null,
      lastRevisionAt: this.lastRevisionAt?.toISOString() ?? null,
    };
  }
}

/** 목록 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class SessionPageView {
  constructor(
    readonly sessions: readonly SessionSummaryView[],
    readonly next: string | null,
  ) {}

  toJSON() {
    return { sessions: this.sessions.map((s) => s.toJSON()), next: this.next };
  }
}

/** 찾은 세션 한 줄. 본문 조각은 찾은 말 둘레 (본문에 없고 제목에만 있으면 본문 앞부분) */
export class SessionHitView {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly project: string | null,
    readonly tool: string,
    readonly lastRevisionAt: Date | null,
    readonly excerpt: string,
  ) {}
}

/** 찾은 결과 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class SessionHitPageView {
  constructor(
    readonly hits: readonly SessionHitView[],
    readonly next: string | null,
  ) {}
}

/** 판 하나의 내용. 칸은 화면에 보일 순서대로 */
export class SessionRevisionView {
  constructor(
    readonly seq: number,
    readonly kind: string,
    readonly actorType: string,
    readonly createdAt: Date,
    readonly title: string,
    readonly tags: readonly string[],
    readonly sections: readonly SessionSectionView[],
    readonly warnings: readonly RedactionView[],
    readonly markdown: string,
  ) {}

  toJSON() {
    return {
      seq: this.seq,
      kind: this.kind,
      actorType: this.actorType,
      createdAt: this.createdAt.toISOString(),
      title: this.title,
      tags: [...this.tags],
      sections: this.sections.map((s) => s.toJSON()),
      warnings: this.warnings.map((w) => w.toJSON()),
      markdown: this.markdown,
    };
  }
}

/** 판 기록의 한 줄 (내용 없이) */
export class RevisionStampView {
  constructor(
    readonly seq: number,
    readonly kind: string,
    readonly actorType: string,
    readonly createdAt: Date,
    readonly redactionCount: number,
  ) {}

  toJSON() {
    return {
      seq: this.seq,
      kind: this.kind,
      actorType: this.actorType,
      createdAt: this.createdAt.toISOString(),
      redactions: this.redactionCount,
    };
  }
}

/** 세션 하나: 목록 정보 + 지금 판 + 판 기록 */
export class SessionDetailView {
  constructor(
    readonly summary: SessionSummaryView,
    readonly sourceSessionId: string,
    readonly head: SessionRevisionView,
    readonly history: readonly RevisionStampView[],
  ) {}

  toJSON() {
    return {
      ...this.summary.toJSON(),
      sourceSessionId: this.sourceSessionId,
      head: this.head.toJSON(),
      history: this.history.map((h) => h.toJSON()),
    };
  }
}

/** AI 도구가 읽는 세션 하나: 목록 정보 + 지금 판 */
export class SessionNoteView {
  constructor(
    readonly summary: SessionSummaryView,
    readonly head: SessionRevisionView,
  ) {}
}
