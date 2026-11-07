import { Actor, BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import { type ChangeWork, type NewNode, TargetEntity } from '../change/change-target';
import type { SessionNew, SessionRevisionNew, SessionRow } from '../vault.tables';
import { SessionSavedView } from './session.view';
import { Redaction, SessionNote } from './session-note';

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

  private constructor(
    readonly status: string,
    readonly sessionId: string,
    readonly seq: number,
    readonly warnings: readonly Redaction[],
  ) {}

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
      String(stored.sessionId),
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
    return new SessionSavedView(this.status, this.sessionId, this.seq, this.warnings, site);
  }
}

/** sessions 한 줄 + 점의 id. 대표 wiki를 바꿀 때는 휴지통 표시, 대화로 찾을 때는 있는 판의 내용을 함께 읽는다 */
export interface LoadedSession extends SessionRow {
  id: string;
  deleted_at?: Date | null;
  /** 이미 있는 판의 내용 해시 → 판 번호 (같은 내용이 다시 오면 판을 만들지 않는다) */
  known?: Readonly<Record<string, number>> | null;
}

// 세션: AI 도구의 대화 하나. 같은 대화를 다시 저장하면 새 판이 쌓이고, 지금 판(head)이 새 판으로 바뀐다.
// 대화는 (공간, 기기, 도구, 대화 id)로 구분한다: 다른 기기가 같은 대화 id를 보내도 다른 세션이다.
// AI는 공개 여부를 정할 수 없다. 새 세션은 늘 비공개 (2026-10-10 결정, 공개는 사람이나 검토 규칙을 거친다).
// 대표 wiki(도착 구역이면 비어 있음)는 변경 묶음으로만 바꾼다. 사람이 정하면 AI가 바로 바꾸지 못한다.
// 판(session_revisions)은 추가만 한다. 원본(origin)은 AI 도구가 올린 노트다. 사람 판·합친 판은 관리 화면 편집 때 생긴다.
export class Session extends TargetEntity<LoadedSession, NewNode<SessionNew>> {
  static readonly PRIVATE = 'private';
  static readonly PUBLIC = 'public';
  /** 사람이 정한 대표 wiki를 pinned_sections에 적는 이름. 칸 이름과 겹치지 않는다 */
  static readonly WIKI_KEY = '#wiki';
  /** 도구 이름: claude-code, codex … */
  private static readonly TOOL = /^[a-z0-9][a-z0-9-]{0,39}$/;
  /** AI 도구가 올린 판 (session_revisions.kind) */
  private static readonly ORIGIN = 'origin';
  /** Actor 종류 → 판에 남기는 만든 쪽 (session_revisions.actor_type) */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'device',
    system: 'system',
  };

  readonly targetKind = 'session';
  private readonly known = new Map<string, number>();
  private added: SessionRevisionNew | null = null;

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
        started_at: startedAt,
      },
      true,
    );
  }

  static restore(row: LoadedSession): Session {
    const session = new Session(row);
    for (const [hash, seq] of Object.entries(row.known ?? {})) session.known.set(hash, seq);
    return session;
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): SessionRevisionNew | null {
    return this.added;
  }

  /** 저장이 끝난 뒤 Repository가 부른다 */
  revisionSaved(): void {
    this.added = null;
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
    const revision = this.addRevision(note, by, now);
    this.known.set(note.hash, revision.seq);
    this.record(
      new DomainEvent('vault.session.saved', 1, this.spaceId, {
        sessionId: this.id,
        revisionId: revision.id,
        seq: revision.seq,
        deviceId: this.row.device_id,
        project: this.row.project,
        created: this.isNew,
      }),
    );
    return SessionReceipt.saved(this.id, revision.seq, note.redactions);
  }

  /** 사람이 정한 칸 (새 세션이면 없다) */
  private get pinned(): readonly string[] {
    return this.row.pinned_sections ?? [];
  }

  /** 새 원본 판을 쌓고 지금 판과 찾기용 사본(제목 · 본문)을 그 판에 맞춘다 */
  private addRevision(note: SessionNote, by: Actor, now: Date): SessionRevisionNew {
    const { head_revision_id: parent, revision_count: count } = this.row;
    const revision: SessionRevisionNew = {
      id: BaseEntity.newId(),
      session_id: this.id,
      seq: count + 1,
      kind: Session.ORIGIN,
      parent_ids: parent ? [parent] : [],
      ...note.revision(),
      actor_type: Session.ACTOR_TYPES[by.kind] ?? 'system',
      actor_id: by.id,
      created_at: now,
    };
    this.added = revision;
    this.put('head_revision_id', revision.id);
    this.put('head_title', note.title);
    this.put('head_text', revision.body_md);
    this.put('revision_count', revision.seq);
    this.put('last_revision_at', now);
    return revision;
  }
}
