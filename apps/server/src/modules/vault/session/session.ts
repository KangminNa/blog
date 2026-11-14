import {
  type Actor,
  BaseEntity,
  DomainEvent,
  type LeasedWork,
  Redaction,
  RuleViolation,
} from '../../platform';
import { type ChangeWork, type NewNode, TargetEntity } from '../change/change-target';
import type {
  SessionNew,
  SessionRevisionNew,
  SessionRow,
  SessionTranscriptNew,
} from '../vault.tables';
import { SessionSavedView, TranscriptSavedView } from './session.view';
import { SessionNote } from './session-note';
import type { SessionTranscript } from './session-transcript';

/**
 * 세션 저장 한 번의 결과. 같은 request_id가 다시 오면 이 기록(platform.idempotency)을 되살려 그대로 돌려준다.
 *   saved      새 판이 쌓였다
 *   unchanged  이미 있는 판과 내용이 같아 판을 만들지 않았다
 *   duplicate  같은 요청이 다시 왔다 (처음 결과 그대로)
 */
export class SessionReceipt {
  static readonly SAVED = 'saved';
  static readonly UNCHANGED = 'unchanged';
  static readonly DUPLICATE = 'duplicate';
  /** 쌓지 않았다: 모으지 않는 프로젝트의 원문, 더 새 원문의 노트가 이미 있는 옛 노트 */
  static readonly SKIPPED = 'skipped';

  private constructor(
    readonly status: string,
    /** 쌓지 않은 원문(모으지 않는 프로젝트)은 세션이 없다 */
    readonly sessionId: string | null,
    readonly seq: number,
    readonly warnings: readonly Redaction[],
  ) {}

  static skipped(sessionId: string | null, seq: number): SessionReceipt {
    return new SessionReceipt(SessionReceipt.SKIPPED, sessionId, seq, []);
  }

  static saved(sessionId: string, seq: number, warnings: readonly Redaction[]): SessionReceipt {
    return new SessionReceipt(SessionReceipt.SAVED, sessionId, seq, warnings);
  }

  static unchanged(sessionId: string, seq: number, warnings: readonly Redaction[]): SessionReceipt {
    return new SessionReceipt(SessionReceipt.UNCHANGED, sessionId, seq, warnings);
  }

  /** 남겨 둔 결과(toJSON)에서. 상태는 duplicate */
  static replay(stored: Readonly<Record<string, unknown>>): SessionReceipt {
    const warnings = Array.isArray(stored.warnings) ? stored.warnings : [];
    return new SessionReceipt(
      SessionReceipt.DUPLICATE,
      stored.sessionId === null ? null : String(stored.sessionId),
      Number(stored.seq),
      warnings.map((w) => Redaction.restore(w as Record<string, unknown>)),
    );
  }

  toJSON(): object {
    return {
      status: this.status,
      sessionId: this.sessionId,
      seq: this.seq,
      warnings: this.warnings,
    };
  }

  /** save_session의 답 (AI에게). site는 블로그의 사이트 주소 */
  view(site: string): SessionSavedView {
    return new SessionSavedView(this.status, this.sessionId ?? '', this.seq, this.warnings, site);
  }

  /** save_transcript · save_note의 답. seq는 원문의 번호, 노트면 판의 번호 */
  transcriptView(): TranscriptSavedView {
    return new TranscriptSavedView(this.status, this.sessionId, this.seq, this.warnings);
  }
}

/** sessions 한 줄 + 점의 id. 대표 wiki를 바꿀 때는 휴지통 표시, 대화로 찾을 때는 있는 판의 내용을 함께 읽는다 */
export interface LoadedSession extends SessionRow {
  id: string;
  deleted_at?: Date | null;
  /** 이미 있는 판의 내용 해시 → 판 번호 (같은 내용이 다시 오면 판을 만들지 않는다) */
  known?: Readonly<Record<string, number>> | null;
  /** 이미 있는 원문의 내용 해시 → 원문 번호 (같은 원문이 다시 오면 쌓지 않는다) */
  known_transcripts?: Readonly<Record<string, number>> | null;
}

// 세션: AI 도구의 대화 하나. 같은 대화를 다시 저장하면 새 판이 쌓이고, 지금 판(head)이 새 판으로 바뀐다.
// 대화는 (공간, 기기, 도구, 대화 id)로 구분한다: 다른 기기가 같은 대화 id를 보내도 다른 세션이다.
// AI는 공개 여부를 정할 수 없다. 새 세션은 늘 비공개 (원칙 5, 공개는 사람이나 검토 규칙을 거친다).
// 대표 wiki(도착 구역이면 비어 있음)는 변경 묶음으로만 바꾼다. 사람이 정하면 AI가 바로 바꾸지 못한다.
// 판(session_revisions)은 추가만 한다. 원본(origin)은 AI 도구가 올린 노트다. 사람 판·합친 판은 관리 화면 편집 때 생긴다.
// 원문(session_transcripts, 2차 4단계)도 추가만 한다: 수집 훅 · 확장이 원문을 올리면 노트 없이 세션이 생기고,
// 서버 러너가 그 원문으로 쓴 노트가 원본 판이 된다 (세션 노트 일, 에이전트 없이 서버의 로그인으로).
export class Session extends TargetEntity<LoadedSession, NewNode<SessionNew>> {
  static readonly PRIVATE = 'private';
  static readonly PUBLIC = 'public';
  /** 사람이 정한 대표 wiki를 pinned_sections에 적는 이름. 칸 이름과 겹치지 않는다 */
  static readonly WIKI_KEY = '#wiki';
  /** 도구 이름: claude-code, codex … */
  private static readonly TOOL = /^[a-z0-9][a-z0-9-]{0,39}$/;
  /** AI 도구가 올린 판 (session_revisions.kind) */
  private static readonly ORIGIN = 'origin';
  /**
   * 세션 노트 일 (task가 에이전트 없이 서버의 로그인으로 돌린다): 종류, 일을 요청하는 이벤트.
   * 대상은 세션, 대상의 판은 원문 번호다. 같은 원문의 요청은 requestId가 같아 일이 하나다
   */
  static readonly NOTE_KIND = 'session_note';
  private static readonly NOTE_REQUESTED = 'task.agentless.requested';
  private static readonly NOTE_TITLE = '세션 노트 · ';
  private static readonly UNTITLED = '제목 없는 세션';
  /** 서버 러너가 쓴 노트의 만든 쪽 (session_revisions.actor_type) */
  private static readonly AI = 'ai';
  /** Actor 종류 → 판에 남기는 만든 쪽 (session_revisions.actor_type) */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'device',
    system: 'system',
  };

  readonly targetKind = 'session';
  private readonly known = new Map<string, number>();
  private readonly transcripts = new Map<string, number>();
  private added: SessionRevisionNew | null = null;
  private addedText: SessionTranscriptNew | null = null;

  /** 세션을 올릴 수 있는 요청자: 연결된 기기만. [공간 id, 기기 id] */
  static uploader(by: Actor): readonly [string, string] {
    if (by.kind !== 'device' || !by.spaceId || !by.id)
      throw new RuleViolation('세션은 연결된 기기의 AI 도구에서만 올릴 수 있어요');
    return [by.spaceId, by.id];
  }

  /** 대화의 첫 저장 */
  static open(
    by: Actor,
    tool: string,
    sourceSessionId: string,
    project: string | null,
    startedAt: Date | null,
  ): Session {
    const [spaceId, deviceId] = Session.uploader(by);
    if (!Session.TOOL.test(tool))
      throw new RuleViolation(
        `도구 이름은 영문 소문자·숫자·-로 써 주세요 (예: claude-code): ${tool}`,
      );
    const id = BaseEntity.newId();
    return new Session(
      {
        id,
        node_id: id,
        space_id: spaceId,
        device_id: deviceId,
        tool,
        source_session_id: sourceSessionId,
        project: project?.trim() || null,
        visibility: Session.PRIVATE,
        head_revision_id: null,
        revision_count: 0,
        transcript_count: 0,
        noted_seq: 0,
        started_at: startedAt,
      },
      true,
    );
  }

  static restore(row: LoadedSession): Session {
    const session = new Session(row);
    for (const [hash, seq] of Object.entries(row.known ?? {})) session.known.set(hash, seq);
    for (const [hash, seq] of Object.entries(row.known_transcripts ?? {}))
      session.transcripts.set(hash, seq);
    return session;
  }

  /** 세션 노트 일이면 [세션 id, 원문 번호]. 러너가 쥔 일이 세션 노트 일이 아니면 RuleViolation */
  static noteWork(work: LeasedWork): readonly [string, number] {
    const { kind, targetKind, targetId, targetVersion } = work;
    if (kind !== Session.NOTE_KIND || targetKind !== 'session' || !targetId || !targetVersion)
      throw new RuleViolation('세션 노트 일이 아니에요');
    return [targetId, targetVersion];
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): SessionRevisionNew | null {
    return this.added;
  }

  /** 이번에 새로 쌓인 원문 (Repository가 저장한다) */
  get addedTranscript(): SessionTranscriptNew | null {
    return this.addedText;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  revisionSaved(): void {
    this.added = null;
    this.addedText = null;
  }

  /** 대표 wiki. 비어 있으면 도착 구역 */
  get wikiId(): string | null {
    return this.row.wiki_id ?? null;
  }

  /** 대표 wiki를 사람이 정했는가 */
  get wikiPinned(): boolean {
    return this.pinned.includes(Session.WIKI_KEY);
  }

  get gone(): boolean {
    return (this.row.deleted_at ?? null) !== null;
  }

  /** 대표 wiki를 정한다. null이면 도착 구역으로. 사람이 정하면 표시가 남는다 */
  assignTo(wikiId: string | null, work: ChangeWork): void {
    if (work.human && !this.wikiPinned)
      this.put('pinned_sections', [...this.pinned, Session.WIKI_KEY]);
    if (wikiId === this.wikiId) return;
    this.put('wiki_id', wikiId);
    this.record(
      new DomainEvent('vault.session.assigned', 1, this.spaceId, { sessionId: this.id, wikiId }),
    );
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return { version: this.version, wiki_id: this.wikiId, pinned_sections: this.pinned };
  }

  /** 앞 상태로 돌아간다. 세션은 변경 묶음이 만들지 않으므로 before는 늘 있다 */
  rollBack(before: Readonly<Record<string, unknown>> | null): void {
    if (before === null) return;
    this.put('wiki_id', before.wiki_id === null ? null : String(before.wiki_id));
    this.put('pinned_sections', before.pinned_sections as string[]);
  }

  /**
   * AI 도구가 보낸 노트(민감정보를 지운 것)를 받는다. 이미 있는 판과 내용이 같으면 판을 만들지 않고,
   * 다르면 새 원본 판을 쌓고 지금 판으로 삼는다.
   */
  receive(note: SessionNote, by: Actor, now: Date): SessionReceipt {
    const same = this.known.get(note.hash);
    if (same !== undefined) return SessionReceipt.unchanged(this.id, same, note.redactions);
    const revision = this.addRevision(note, Session.ACTOR_TYPES[by.kind] ?? 'system', by.id, now);
    return SessionReceipt.saved(this.id, revision.seq, note.redactions);
  }

  /**
   * 수집 훅 · 확장이 올린 원문(민감정보를 지운 것)을 받는다. 이미 있는 원문과 같으면 쌓지 않고,
   * 다르면 새 원문을 쌓고 그 원문으로 세션 노트를 쓰는 일을 요청한다. 노트가 아직 없으면 보낸 제목을 보인다
   */
  receiveTranscript(
    transcript: SessionTranscript,
    title: string | null,
    by: Actor,
    now: Date,
  ): SessionReceipt {
    const same = this.transcripts.get(transcript.hash);
    if (same !== undefined) return SessionReceipt.unchanged(this.id, same, transcript.redactions);
    const seq = (this.row.transcript_count ?? 0) + 1;
    this.addedText = {
      id: BaseEntity.newId(),
      session_id: this.id,
      seq,
      text: transcript.text,
      content_hash: transcript.hash,
      redactions: transcript.redactions.length
        ? transcript.redactions.map((r) => r.toJSON())
        : null,
      actor_type: Session.ACTOR_TYPES[by.kind] ?? 'system',
      actor_id: by.id,
      created_at: now,
    };
    this.transcripts.set(transcript.hash, seq);
    this.put('transcript_count', seq);
    this.put('last_revision_at', now);
    if (title && (this.row.revision_count ?? 0) === 0) this.put('head_title', title);
    const shown = this.row.head_title || title || Session.UNTITLED;
    this.record(
      new DomainEvent(Session.NOTE_REQUESTED, 1, this.spaceId, {
        requestId: `note:${this.id}:${seq}`,
        kind: Session.NOTE_KIND,
        title: `${Session.NOTE_TITLE}${shown}`.slice(0, SessionNote.TITLE_MAX),
        targetKind: this.targetKind,
        targetId: this.id,
        baseVersion: seq,
      }),
    );
    return SessionReceipt.saved(this.id, seq, transcript.redactions);
  }

  /**
   * 서버 러너가 원문(seq번)으로 쓴 노트를 원본 판으로 쌓는다. 더 새 원문의 노트가 이미 있으면 쌓지 않고(skipped),
   * 이미 있는 판과 내용이 같으면 판을 만들지 않는다
   */
  writeNote(note: SessionNote, seq: number, now: Date): SessionReceipt {
    if (seq < (this.row.noted_seq ?? 0)) return SessionReceipt.skipped(this.id, seq);
    this.put('noted_seq', seq);
    const same = this.known.get(note.hash);
    if (same !== undefined) return SessionReceipt.unchanged(this.id, same, note.redactions);
    const revision = this.addRevision(note, Session.AI, null, now);
    return SessionReceipt.saved(this.id, revision.seq, note.redactions);
  }

  /** 사람이 정한 칸 (새 세션이면 없다) */
  private get pinned(): readonly string[] {
    return this.row.pinned_sections ?? [];
  }

  /**
   * 새 원본 판을 쌓고 지금 판과 찾기용 사본(제목 · 본문)을 그 판에 맞춘다. 판이 쌓였다고 알린다 (자동 정리 · 알림).
   * 새 세션인지는 첫 판인지로 본다 (원문이 먼저 온 세션은 노트가 와야 들어온 것이다)
   */
  private addRevision(
    note: SessionNote,
    actorType: string,
    actorId: string | null,
    now: Date,
  ): SessionRevisionNew {
    const { head_revision_id: parent, revision_count: count } = this.row;
    const revision: SessionRevisionNew = {
      id: BaseEntity.newId(),
      session_id: this.id,
      seq: count + 1,
      kind: Session.ORIGIN,
      parent_ids: parent ? [parent] : [],
      ...note.revision(),
      actor_type: actorType,
      actor_id: actorId,
      created_at: now,
    };
    this.added = revision;
    this.known.set(note.hash, revision.seq);
    this.put('head_revision_id', revision.id);
    this.put('head_title', note.title);
    this.put('head_text', revision.body_md);
    this.put('revision_count', revision.seq);
    this.put('last_revision_at', now);
    this.record(
      new DomainEvent('vault.session.saved', 1, this.spaceId, {
        sessionId: this.id,
        revisionId: revision.id,
        seq: revision.seq,
        deviceId: this.row.device_id,
        project: this.row.project,
        created: revision.seq === 1,
      }),
    );
    return revision;
  }
}
