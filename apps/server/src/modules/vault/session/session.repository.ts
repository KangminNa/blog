import { BaseRepository, type Row } from '../../platform';
import { Session } from './session';
import { SessionNote } from './session-note';

// vault.nodes(세션) + sessions + session_revisions ↔ Session
export class SessionRepository extends BaseRepository<Session> {
  protected toEntity(row: Row): Session {
    const known = Object.entries((row.known ?? {}) as Record<string, number>);
    return Session.restore(
      String(row.node_id),
      Number(row.version),
      String(row.space_id),
      String(row.device_id),
      String(row.tool),
      String(row.source_session_id),
      row.project === null ? null : String(row.project),
      String(row.visibility),
      row.started_at === null ? null : new Date(row.started_at),
      row.head_revision_id === null ? null : String(row.head_revision_id),
      Number(row.revision_count),
      row.last_revision_at === null ? null : new Date(row.last_revision_at),
      new Map(known.map(([hash, seq]) => [hash, Number(seq)])),
    );
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
        SELECT s.*,
               (SELECT jsonb_object_agg(r.content_hash, r.seq)
                  FROM vault.session_revisions r WHERE r.session_id = s.node_id) AS known
        FROM vault.sessions s
        WHERE s.space_id = ${spaceId} AND s.device_id = ${deviceId}
          AND s.tool = ${tool} AND s.source_session_id = ${sourceSessionId}
        FOR UPDATE OF s`,
    );
  }

  async save(session: Session): Promise<void> {
    const revision = session.addedRevision;
    const note = revision?.note;
    if (session.isNew) {
      await this.sql`
        INSERT INTO vault.nodes (id, space_id, kind) VALUES (${session.id}, ${session.spaceId}, 'session')`;
      await this.sql`
        INSERT INTO vault.sessions (node_id, space_id, device_id, tool, source_session_id, project,
          visibility, head_revision_id, head_title, head_text, revision_count, started_at, last_revision_at)
        VALUES (${session.id}, ${session.spaceId}, ${session.deviceId}, ${session.tool},
          ${session.sourceSessionId}, ${session.project}, ${session.visibility}, ${session.headRevisionId},
          ${note?.title ?? null}, ${note?.toMarkdown() ?? null}, ${session.revisionCount},
          ${session.startedAt}, ${session.lastRevisionAt})`;
      session.markSaved(session.version);
    } else if (note) {
      const result = await this.sql`
        UPDATE vault.sessions SET head_revision_id = ${session.headRevisionId},
          head_title = ${note.title}, head_text = ${note.toMarkdown()},
          revision_count = ${session.revisionCount}, last_revision_at = ${session.lastRevisionAt},
          version = version + 1
        WHERE node_id = ${session.id} AND version = ${session.version}`;
      this.expectUpdated(result.count, session);
    }
    if (revision && note) {
      await this.sql`
        INSERT INTO vault.session_revisions (id, session_id, seq, kind, parent_ids, body_md, sections,
          sections_schema, section_hashes, content_hash, redactions, actor_type, actor_id, created_at)
        VALUES (${revision.id}, ${session.id}, ${revision.seq}, ${revision.kind},
          ${revision.parentIds as string[]}, ${note.toMarkdown()}, ${this.sql.json(note.toJSON() as never)},
          ${SessionNote.SCHEMA}, ${this.sql.json(note.sectionHashes())}, ${note.hash},
          ${note.redactions.length > 0 ? this.sql.json(note.redactions.map((r) => r.toJSON()) as never) : null},
          ${revision.actorType}, ${revision.actorId}, ${revision.createdAt})`;
    }
    await this.publishEvents(session);
  }
}
