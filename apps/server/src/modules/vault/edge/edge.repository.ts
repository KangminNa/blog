import { TableRepository } from '../../platform';
import { edgeKinds, edges, nodes } from '../vault.schema';
import type { EdgeRow } from '../vault.tables';
import { Edge, EdgeKind } from './edge';

// vault.edges ↔ Edge. 지운 선도 행으로 남는다. 불러오기·잠그기·저장은 기반이 하고, 여기에는 선을 찾는 SQL만 있다.
export class EdgeRepository extends TableRepository<EdgeRow, Edge> {
  protected readonly table = edges;
  protected readonly noun = '연결선';

  protected toEntity(row: EdgeRow): Edge {
    return Edge.restore(row);
  }

  /** 연결 종류 목록. 방향과 AI가 만들 수 있는지 (설명은 읽지 않는다) */
  async kinds(): Promise<ReadonlyMap<string, EdgeKind>> {
    const rows = await this.rows(edgeKinds, {}, { columns: ['name', 'directed', 'ai_creatable'] });
    return new Map(rows.map((r) => [r.name, new EdgeKind(r.name, r.directed, r.ai_creatable)]));
  }

  /** 이 공간에 살아 있는 점들 */
  async liveNodes(spaceId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.rows(
      nodes,
      { id: ids, space_id: spaceId, deleted_at: null },
      { columns: ['id'] },
    );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * 양 끝과 종류로 선을 잠근다. 행이 없으면 null.
   * 같은 선을 동시에 만들어도 하나만 생기도록, 행이 아직 없어도 그 자리를 잠근다 (트랜잭션이 끝나면 풀린다).
   */
  async lockAt(src: string, dst: string, kind: string): Promise<Edge | null> {
    await this
      .sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vault.edge:${src}:${dst}:${kind}`}, 0))`;
    return this.findOne({ src, dst, kind }, { lock: true });
  }
}
