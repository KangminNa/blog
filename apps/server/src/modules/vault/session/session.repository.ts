import { NodeRepository } from '../change/change-target.repository';
import { type LoadedSession, Session } from './session';

// vault.nodes(세션) + sessions + session_revisions ↔ Session. 저장은 기반이 하고(바뀐 칸만, version으로 늦은 쓰기를 막는다),
// 여기에는 세션을 찾는 SQL과 판(추가만) 넣기가 있다.
export class SessionRepository extends NodeRepository<LoadedSession, Session> {
  protected readonly table = 'vault.sessions';
  protected readonly noun = '세션';
  protected readonly kind = 'session';

  protected toEntity(row: LoadedSession): Session {
    return Session.restore(row);
  }

  /** 세션 한 줄과 휴지통 표시. 휴지통의 세션도 읽는다 */
  protected override select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT s.*, s.node_id AS id, n.deleted_at
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${id} AND s.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF s` : this.sql``}`;
  }

  /**
   * AI 도구의 대화 하나로 세션을 찾아 잠근다. 없으면 null.
   * 같은 대화의 첫 저장이 동시에 와도 세션이 하나만 생기도록, 세션이 아직 없어도 그 대화 자리를 잠근다
   * (트랜잭션이 끝나면 풀린다). 뒤에 온 저장은 앞의 저장이 커밋된 뒤 그 세션을 찾는다.
   */
  async lockBySource(
    spaceId: string,
    deviceId: string,
    tool: string,
    sourceSessionId: string,
  ): Promise<Session | null> {
    const place = `vault.session:${spaceId}:${deviceId}:${tool}:${sourceSessionId}`;
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${place}, 0))`;
    return this.maybeOne(
      await this.sql`
        SELECT s.*, s.node_id AS id,
               (SELECT jsonb_object_agg(r.content_hash, r.seq)
                  FROM vault.session_revisions r WHERE r.session_id = s.node_id) AS known
        FROM vault.sessions s
        WHERE s.space_id = ${spaceId} AND s.device_id = ${deviceId}
          AND s.tool = ${tool} AND s.source_session_id = ${sourceSessionId}
        FOR UPDATE OF s`,
    );
  }

  /**
   * 이 판까지 정리를 요청했다고 적는다. 이미 이 판이나 더 뒤의 판을 요청했으면 false.
   * 세션의 내용이 아니라 요청 기록이라 version을 올리지 않는다: 올리면 정리 일이 들고 간 baseVersion이
   * 어긋나 `session.assign`이 검토로 빠진다.
   */
  async noteTidyRequested(id: string, seq: number): Promise<boolean> {
    const update = await this.sql`
      UPDATE vault.sessions SET tidy_requested_seq = ${seq}
      WHERE node_id = ${id} AND tidy_requested_seq < ${seq}`;
    return update.count > 0;
  }

  /** 새 판 (판은 추가만) */
  protected override async saveParts(session: Session): Promise<void> {
    const revision = session.addedRevision;
    if (!revision) return;
    await this.sql`INSERT INTO vault.session_revisions ${this.sql(revision as never)}`;
    session.revisionSaved();
  }
}
