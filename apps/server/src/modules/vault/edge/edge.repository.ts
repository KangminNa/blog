import { BaseRepository, type Row } from '../../platform';
import { Edge, EdgeKind } from './edge';

// vault.edges ↔ Edge. 지운 선도 행으로 남는다.
export class EdgeRepository extends BaseRepository<Edge> {
  protected toEntity(row: Row): Edge {
    return Edge.restore(
      String(row.id),
      Number(row.version),
      String(row.space_id),
      String(row.src),
      String(row.dst),
      String(row.kind),
      String(row.origin),
      Boolean(row.pinned),
      row.actor_type === null ? null : String(row.actor_type),
      row.actor_id === null ? null : String(row.actor_id),
      new Date(row.created_at),
      row.deleted_at === null ? null : new Date(row.deleted_at),
      row.deleted_by_type === null ? null : String(row.deleted_by_type),
    );
  }

  /** 연결 종류 목록. 방향과 AI가 만들 수 있는지 */
  async kinds(): Promise<ReadonlyMap<string, EdgeKind>> {
    const rows = await this.sql`SELECT name, directed, ai_creatable FROM vault.edge_kinds`;
    return new Map(
      rows.map((r) => [
        String(r.name),
        new EdgeKind(String(r.name), Boolean(r.directed), Boolean(r.ai_creatable)),
      ]),
    );
  }

  /** 이 공간에 살아 있는 점들 */
  async liveNodes(spaceId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.sql`
      SELECT id FROM vault.nodes
      WHERE id = ANY(${ids as string[]}::uuid[]) AND space_id = ${spaceId} AND deleted_at IS NULL`;
    return new Set(rows.map((r) => String(r.id)));
  }

  /**
   * 양 끝과 종류로 선을 잠근다. 행이 없으면 null.
   * 같은 선을 동시에 만들어도 하나만 생기도록, 행이 아직 없어도 그 자리를 잠근다 (트랜잭션이 끝나면 풀린다).
   */
  async lockAt(src: string, dst: string, kind: string): Promise<Edge | null> {
    await this
      .sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vault.edge:${src}:${dst}:${kind}`}, 0))`;
    return this.maybeOne(
      await this.sql`
        SELECT * FROM vault.edges WHERE src = ${src} AND dst = ${dst} AND kind = ${kind} FOR UPDATE`,
    );
  }

  /** 되돌릴 선을 id로 잠근다. 없으면 null */
  async lock(spaceId: string, id: string): Promise<Edge | null> {
    return this.maybeOne(
      await this.sql`
        SELECT * FROM vault.edges WHERE id = ${id} AND space_id = ${spaceId} FOR UPDATE`,
    );
  }

  async save(edge: Edge): Promise<void> {
    if (edge.isNew) {
      await this.sql`
        INSERT INTO vault.edges (id, space_id, src, dst, kind, origin, pinned, actor_type, actor_id, created_at)
        VALUES (${edge.id}, ${edge.spaceId}, ${edge.src}, ${edge.dst}, ${edge.kind}, ${edge.origin},
          ${edge.pinned}, ${edge.actorType}, ${edge.actorId}, ${edge.createdAt})`;
      edge.markInserted();
    } else if (edge.changed) {
      const result = await this.sql`
        UPDATE vault.edges SET ${this.sql(edge.changes)}, version = version + 1
        WHERE id = ${edge.id} AND version = ${edge.version}`;
      this.expectUpdated(result.count, edge);
    }
    edge.clearChanges();
    await this.publishEvents(edge);
  }
}
