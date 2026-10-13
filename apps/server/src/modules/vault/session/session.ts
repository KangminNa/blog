import { Actor, BaseEntity, DomainEvent, RuleViolation } from '../../platform';
import { Redaction, type SessionNote } from './session-note';

/** 세션의 판 하나 (추가만). 원본(origin)은 AI 도구가 올린 노트. 사람 판·합친 판은 관리 화면 편집 때 생긴다 */
export class SessionRevision {
  static readonly ORIGIN = 'origin';
  static readonly HUMAN = 'human';
  static readonly MERGE = 'merge';
  /** Actor 종류 → 판에 남기는 만든 쪽 (session_revisions.actor_type) */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'device',
    system: 'system',
  };

  private constructor(
    readonly id: string,
    readonly seq: number,
    readonly kind: string,
    readonly parentIds: readonly string[],
    readonly note: SessionNote,
    readonly actorType: string,
    readonly actorId: string | null,
    readonly createdAt: Date,
  ) {}

  static origin(
    id: string,
    seq: number,
    parentId: string | null,
    note: SessionNote,
    by: Actor,
    now: Date,
  ): SessionRevision {
    return new SessionRevision(
      id,
      seq,
      SessionRevision.ORIGIN,
      parentId ? [parentId] : [],
      note,
      SessionRevision.ACTOR_TYPES[by.kind] ?? 'system',
      by.id,
      now,
    );
  }
}

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
}

// 세션: AI 도구의 대화 하나. 같은 대화를 다시 저장하면 새 판이 쌓이고, 지금 판(head)이 새 판으로 바뀐다.
// 대화는 (공간, 기기, 도구, 대화 id)로 구분한다: 다른 기기가 같은 대화 id를 보내도 다른 세션이다.
// AI는 공개 여부를 정할 수 없다. 새 세션은 늘 비공개 (2026-10-10 결정, 공개는 사람이나 검토 규칙을 거친다).
export class Session extends BaseEntity {
  static readonly PRIVATE = 'private';
  static readonly PUBLIC = 'public';
  /** 도구 이름: claude-code, codex … */
  private static readonly TOOL = /^[a-z0-9][a-z0-9-]{0,39}$/;

  private added: SessionRevision | null = null;

  private constructor(
    id: string,
    version: number,
    readonly spaceId: string,
    readonly deviceId: string,
    readonly tool: string,
    readonly sourceSessionId: string,
    readonly project: string | null,
    readonly visibility: string,
    readonly startedAt: Date | null,
    private headId: string | null,
    private count: number,
    private lastAt: Date | null,
    /** 이미 있는 판의 내용 해시 → 판 번호 (같은 내용이 다시 오면 판을 만들지 않는다) */
    private readonly known: Map<string, number>,
    readonly isNew: boolean,
  ) {
    super(id, version);
  }

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
    return new Session(
      BaseEntity.newId(),
      1,
      spaceId,
      deviceId,
      tool,
      sourceSessionId,
      project?.trim() || null,
      Session.PRIVATE,
      startedAt,
      null,
      0,
      null,
      new Map(),
      true,
    );
  }

  static restore(
    id: string,
    version: number,
    spaceId: string,
    deviceId: string,
    tool: string,
    sourceSessionId: string,
    project: string | null,
    visibility: string,
    startedAt: Date | null,
    headRevisionId: string | null,
    revisionCount: number,
    lastRevisionAt: Date | null,
    known: ReadonlyMap<string, number>,
  ): Session {
    return new Session(
      id,
      version,
      spaceId,
      deviceId,
      tool,
      sourceSessionId,
      project,
      visibility,
      startedAt,
      headRevisionId,
      revisionCount,
      lastRevisionAt,
      new Map(known),
      false,
    );
  }

  get headRevisionId(): string | null {
    return this.headId;
  }

  get revisionCount(): number {
    return this.count;
  }

  get lastRevisionAt(): Date | null {
    return this.lastAt;
  }

  /** 이번에 새로 쌓인 판 (Repository가 저장한다) */
  get addedRevision(): SessionRevision | null {
    return this.added;
  }

  /**
   * AI 도구가 보낸 노트(민감정보를 지운 것)를 받는다. 이미 있는 판과 내용이 같으면 판을 만들지 않고,
   * 다르면 새 원본 판을 쌓고 지금 판으로 삼는다.
   */
  receive(note: SessionNote, by: Actor, now: Date): SessionReceipt {
    const same = this.known.get(note.hash);
    if (same !== undefined) return SessionReceipt.unchanged(this.id, same, note.redactions);
    const revision = SessionRevision.origin(
      BaseEntity.newId(),
      this.count + 1,
      this.headId,
      note,
      by,
      now,
    );
    this.added = revision;
    this.headId = revision.id;
    this.count = revision.seq;
    this.lastAt = now;
    this.known.set(note.hash, revision.seq);
    this.record(
      new DomainEvent('vault.session.saved', 1, this.spaceId, {
        sessionId: this.id,
        revisionId: revision.id,
        seq: revision.seq,
        deviceId: this.deviceId,
        project: this.project,
        created: this.isNew,
      }),
    );
    return SessionReceipt.saved(this.id, revision.seq, note.redactions);
  }
}
