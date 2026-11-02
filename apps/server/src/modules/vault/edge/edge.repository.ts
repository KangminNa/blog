import { TargetEntityRepository } from '../change/change-target.repository';
import type { EdgeKindRow, EdgeRow, NodeRow } from '../vault.tables';
import { Edge, EdgeKind } from './edge';

// vault.edges ↔ Edge. 지운 선도 행으로 남는다.
export class EdgeRepository extends TargetEntityRepository<EdgeRow, Edge> {
  protected readonly table = 'vault.edges';
  protected readonly noun = '연결선';

  protected toEntity(row: EdgeRow): Edge {
    return Edge.restore(row);
  }

  /** 연결 종류 목록. 방향과 AI가 만들 수 있는지 */
  async kinds(): Promise<ReadonlyMap<string, EdgeKind>> {
    const rows = await this.sql<Omit<EdgeKindRow, 'description'>[]>`
      SELECT name, directed, ai_creatable FROM vault.edge_kinds`;
    return new Map(rows.map((r) => [r.name, new EdgeKind(r.name, r.directed, r.ai_creatable)]));
  }

  /** 이 공간에 살아 있는 점들 */
  async liveNodes(spaceId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.sql<Pick<NodeRow, 'id'>[]>`
      SELECT id FROM vault.nodes
      WHERE id = ANY(${ids as string[]}::uuid[]) AND space_id = ${spaceId} AND deleted_at IS NULL`;
    return new Set(rows.map((r) => r.id));
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
}
