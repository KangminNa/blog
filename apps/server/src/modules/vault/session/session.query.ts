import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, NotFound, type Row } from '../../platform';
import { ListSessionsRequest, type ReadSessionRequest } from './read-session.request';
import { SessionNote } from './session-note';

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
}

/** 목록 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class SessionPageView {
  constructor(
    readonly sessions: readonly SessionSummaryView[],
    readonly next: string | null,
  ) {}
}

/** 판 하나의 내용 */
export class SessionRevisionView {
  constructor(
    readonly seq: number,
    readonly kind: string,
    readonly actorType: string,
    readonly createdAt: Date,
    readonly note: SessionNote,
    readonly markdown: string,
  ) {}
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
}

/** 세션 하나: 목록 정보 + 지금 판 + 판 기록 */
export class SessionDetailView {
  constructor(
    readonly summary: SessionSummaryView,
    readonly sourceSessionId: string,
    readonly head: SessionRevisionView,
    readonly history: readonly RevisionStampView[],
  ) {}
}

// 세션 읽기: 관리 화면의 세션 목록·상세·판. 지금은 비공개까지 볼 수 있는 요청자(주인, read_all 기기)만.
// 방문자용 공개 세션 보기는 그래프(M2)에서 따로 만든다.
@Injectable()
export class SessionQuery extends BaseQuery {
  private static readonly PAGE = 30;

  async list(actor: Actor, req: ListSessionsRequest): Promise<SessionPageView> {
    actor.assertCan(Actor.READ_ALL);
    const rows = await this.sql`
      SELECT s.* FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL ${this.visibleTo(actor, 's.visibility')}
        ${req.project === null ? this.sql`` : this.sql`AND s.project = ${req.project}`}
        ${req.before === null ? this.sql`` : this.sql`AND (s.last_revision_at, s.node_id) < (${req.before[0]}, ${req.before[1]})`}
      ORDER BY s.last_revision_at DESC, s.node_id DESC
      LIMIT ${SessionQuery.PAGE + 1}`;
    const page = rows.slice(0, SessionQuery.PAGE).map((r) => this.summary(r));
    const last = page.at(-1);
    return new SessionPageView(
      page,
      rows.length > SessionQuery.PAGE && last?.lastRevisionAt
        ? ListSessionsRequest.cursorAfter(last.lastRevisionAt, last.id)
        : null,
    );
  }

  async get(actor: Actor, req: ReadSessionRequest): Promise<SessionDetailView> {
    actor.assertCan(Actor.READ_ALL);
    const session = await this.find(actor, req.id);
    const history = await this.sql`
      SELECT seq, kind, actor_type, created_at, coalesce(jsonb_array_length(redactions), 0) AS redactions
      FROM vault.session_revisions WHERE session_id = ${req.id} ORDER BY seq DESC`;
    const [head] = await this.sql`
      SELECT * FROM vault.session_revisions WHERE id = ${session.head_revision_id}`;
    if (!head) throw new NotFound('세션의 지금 판을 찾을 수 없어요');
    return new SessionDetailView(
      this.summary(session),
      String(session.source_session_id),
      this.revision(head),
      history.map(
        (r) =>
          new RevisionStampView(
            Number(r.seq),
            String(r.kind),
            String(r.actor_type),
            new Date(r.created_at),
            Number(r.redactions),
          ),
      ),
    );
  }

  /** 판 하나 (지난 판 보기) */
  async revisionOf(actor: Actor, req: ReadSessionRequest): Promise<SessionRevisionView> {
    actor.assertCan(Actor.READ_ALL);
    await this.find(actor, req.id);
    const [row] = await this.sql`
      SELECT * FROM vault.session_revisions WHERE session_id = ${req.id} AND seq = ${req.seq ?? 0}`;
    if (!row) throw new NotFound(`${req.seq}번 판이 없어요`);
    return this.revision(row);
  }

  /** 볼 수 있는 세션 행 하나 (휴지통·다른 공간·비공개 제외) */
  private async find(actor: Actor, id: string): Promise<Row> {
    const [row] = await this.sql`
      SELECT s.* FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${id} AND s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL
        ${this.visibleTo(actor, 's.visibility')}`;
    if (!row) throw new NotFound('세션을 찾을 수 없어요');
    return row;
  }

  private summary(r: Row): SessionSummaryView {
    return new SessionSummaryView(
      String(r.node_id),
      String(r.head_title ?? ''),
      r.project === null ? null : String(r.project),
      String(r.tool),
      String(r.device_id),
      String(r.visibility),
      Number(r.revision_count),
      r.started_at === null ? null : new Date(r.started_at),
      r.last_revision_at === null ? null : new Date(r.last_revision_at),
    );
  }

  private revision(r: Row): SessionRevisionView {
    return new SessionRevisionView(
      Number(r.seq),
      String(r.kind),
      String(r.actor_type),
      new Date(r.created_at),
      SessionNote.restore(r.sections, r.redactions),
      String(r.body_md),
    );
  }
}
