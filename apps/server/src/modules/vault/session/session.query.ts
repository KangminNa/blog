import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, Database, NotFound } from '../../platform';
import type { SessionRevisionRow, SessionRow } from '../vault.tables';
import { SensitivePolicy } from './sensitive.policy';
import { Session } from './session';
import {
  type CheckSessionInput,
  type GetSessionInput,
  ListSessionsInput,
  type ReadSessionInput,
  SearchSessionsInput,
} from './session.input';
import {
  type RevisionStampRow,
  RevisionStampView,
  type SessionCheckRow,
  SessionCheckView,
  SessionDetailView,
  SessionHitPageView,
  type SessionHitRow,
  SessionHitView,
  SessionNoteView,
  SessionPageView,
  SessionRevisionView,
  SessionSummaryView,
} from './session.view';
import { SessionNote } from './session-note';

// 세션 읽기. 관리 화면의 목록·상세·판은 비공개까지 볼 수 있는 요청자(주인, read_all 기기)만,
// AI 도구의 찾기·읽기(search · note)는 read_public이나 read_all 중 하나로, read_public은 공개 세션만 본다.
// 방문자용 공개 세션 보기는 그래프(M2)에서 따로 만든다.
@Injectable()
export class SessionQuery extends BaseQuery {
  private static readonly PAGE = 30;
  /** 찾은 결과의 본문 조각: 전체 길이, 그중 찾은 말 앞에 남길 길이 */
  private static readonly EXCERPT = 160;
  private static readonly EXCERPT_LEAD = 40;

  constructor(
    db: Database,
    private readonly sensitive: SensitivePolicy,
  ) {
    super(db);
  }

  /**
   * 저장 전 검사 (AI 도구의 check_session). 아무것도 쓰지 않는다.
   * 노트 모양(제목, 칸 하나 이상)을 보고, 서버가 지울 비밀값을 알려 주고, 이번 저장에 쓸 request_id와 대화 id를 준다.
   * 대화 id를 모르면 새로 만든다 ("conv-" + UUID). 같은 대화로 이미 저장한 세션이 있으면 그 판 수도 알려 준다.
   */
  async check(actor: Actor, req: CheckSessionInput, site: string): Promise<SessionCheckView> {
    actor.assertCan(Actor.UPLOAD);
    const [spaceId, deviceId] = Session.uploader(actor);
    const note = this.sensitive.clean(SessionNote.write(req.title, req.tags, req.sections));
    const [found] =
      req.sourceSessionId && req.tool
        ? await this.sql<SessionCheckRow[]>`
            SELECT s.node_id,
                   (SELECT count(*) FROM vault.session_revisions r WHERE r.session_id = s.node_id)::int AS revisions
            FROM vault.sessions s
            WHERE s.space_id = ${spaceId} AND s.device_id = ${deviceId}
              AND s.tool = ${req.tool} AND s.source_session_id = ${req.sourceSessionId}`
        : [];
    return new SessionCheckView(
      randomUUID(),
      req.sourceSessionId ?? `conv-${randomUUID()}`,
      found ?? null,
      note.redactions,
      site,
      SessionNote.LIMITS,
    );
  }

  async list(actor: Actor, req: ListSessionsInput): Promise<SessionPageView> {
    actor.assertCan(Actor.READ_ALL);
    const rows = await this.sql<SessionRow[]>`
      SELECT s.* FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL ${this.visibleTo(actor, 's.visibility')}
        ${req.project === null ? this.sql`` : this.sql`AND s.project = ${req.project}`}
        ${req.before === null ? this.sql`` : this.sql`AND (s.last_revision_at, s.node_id) < (${req.before[0]}, ${req.before[1]})`}
      ORDER BY s.last_revision_at DESC, s.node_id DESC
      LIMIT ${SessionQuery.PAGE + 1}`;
    const page = rows.slice(0, SessionQuery.PAGE);
    const last = page.at(-1);
    return new SessionPageView(
      page.map((r) => new SessionSummaryView(r)),
      rows.length > SessionQuery.PAGE && last?.last_revision_at
        ? ListSessionsInput.cursorAfter(last.last_revision_at, last.node_id)
        : null,
    );
  }

  async get(actor: Actor, req: ReadSessionInput): Promise<SessionDetailView> {
    actor.assertCan(Actor.READ_ALL);
    const session = await this.find(actor, req.id);
    const history = await this.sql<RevisionStampRow[]>`
      SELECT seq, kind, actor_type, created_at, coalesce(jsonb_array_length(redactions), 0) AS redactions
      FROM vault.session_revisions WHERE session_id = ${req.id} ORDER BY seq DESC`;
    return new SessionDetailView(
      session,
      SessionQuery.revision(await this.headOf(session)),
      history.map((r) => new RevisionStampView(r)),
    );
  }

  /** 판 하나 (지난 판 보기) */
  async revisionOf(actor: Actor, req: ReadSessionInput): Promise<SessionRevisionView> {
    actor.assertCan(Actor.READ_ALL);
    await this.find(actor, req.id);
    const [row] = await this.sql<SessionRevisionRow[]>`
      SELECT * FROM vault.session_revisions WHERE session_id = ${req.id} AND seq = ${req.seq ?? 0}`;
    if (!row) throw new NotFound(`${req.seq}번 판이 없어요`);
    return SessionQuery.revision(row);
  }

  /**
   * 키워드로 찾기 (AI 도구의 search_sessions). 제목과 지금 판의 본문에서 찾는다 (pg_bigm: 대소문자 구분).
   * 공개 범위를 SQL에서 먼저 거른 뒤 쪽을 나눠서, 비공개 세션은 결과·본문 조각·next 어디에도 영향을 주지 않는다.
   * 순서는 세션 id(UUIDv7) 내림차순: 저장해도 바뀌지 않는 값이라 쪽을 넘기는 사이에 새 판이 쌓여도
   * 세션이 빠지거나 두 번 나오지 않는다.
   */
  async search(actor: Actor, req: SearchSessionsInput): Promise<SessionHitPageView> {
    this.assertCanRead(actor);
    const [lead = ''] = req.words;
    const rows = await this.sql<SessionHitRow[]>`
      SELECT s.node_id, s.head_title, s.project, s.tool, s.last_revision_at,
             substr(s.head_text,
                    greatest(position(${lead} in s.head_text) - ${SessionQuery.EXCERPT_LEAD}, 1),
                    ${SessionQuery.EXCERPT}) AS excerpt
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL ${this.visibleTo(actor, 's.visibility')}
        ${req.words.map((word) => this.sql`AND (s.head_title LIKE likequery(${word}) OR s.head_text LIKE likequery(${word}))`)}
        ${req.project === null ? this.sql`` : this.sql`AND s.project = ${req.project}`}
        ${req.tool === null ? this.sql`` : this.sql`AND s.tool = ${req.tool}`}
        ${req.from === null ? this.sql`` : this.sql`AND s.last_revision_at >= ${req.from}`}
        ${req.to === null ? this.sql`` : this.sql`AND s.last_revision_at <= ${req.to}`}
        ${req.before === null ? this.sql`` : this.sql`AND s.node_id < ${req.before}`}
      ORDER BY s.node_id DESC
      LIMIT ${req.limit + 1}`;
    const hits = rows.slice(0, req.limit);
    const last = hits.at(-1);
    return new SessionHitPageView(
      hits.map((r) => new SessionHitView(r)),
      rows.length > req.limit && last ? SearchSessionsInput.cursorAfter(last.node_id) : null,
    );
  }

  /** 세션 하나의 지금 판 (AI 도구의 get_session). 볼 수 없는 세션은 없는 세션과 똑같이 NotFound */
  async note(actor: Actor, req: GetSessionInput): Promise<SessionNoteView> {
    this.assertCanRead(actor);
    const session = await this.find(actor, req.id);
    const head = await this.headOf(session);
    return new SessionNoteView(session, head, SessionNote.restore(head));
  }

  /** AI 도구의 읽기는 read_public이나 read_all 중 하나만 있어도 된다 */
  private assertCanRead(actor: Actor): void {
    if (!actor.canSeePrivate()) actor.assertCan(Actor.READ_PUBLIC);
  }

  private async headOf(session: SessionRow): Promise<SessionRevisionRow> {
    const [head] = await this.sql<SessionRevisionRow[]>`
      SELECT * FROM vault.session_revisions WHERE id = ${session.head_revision_id}`;
    if (!head) throw new NotFound('세션의 지금 판을 찾을 수 없어요');
    return head;
  }

  /** 볼 수 있는 세션 행 하나 (휴지통·다른 공간·비공개 제외) */
  private async find(actor: Actor, id: string): Promise<SessionRow> {
    const [row] = await this.sql<SessionRow[]>`
      SELECT s.* FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${id} AND s.space_id = ${actor.spaceId} AND n.deleted_at IS NULL
        ${this.visibleTo(actor, 's.visibility')}`;
    if (!row) throw new NotFound('세션을 찾을 수 없어요');
    return row;
  }

  private static revision(row: SessionRevisionRow): SessionRevisionView {
    return new SessionRevisionView(row, SessionNote.restore(row));
  }
}
