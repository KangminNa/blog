import type { Sql } from '../../platform';
import type { GraphViewRow, NodeLayoutNew, NodeRow } from '../vault.tables';
import type {
  RestoredCategory,
  RestoredEdge,
  RestoredPin,
  RestoredPostMark,
  RestoredSession,
  RestoredWiki,
} from './restored-items';

// 복원의 vault 쓰기. 여러 데이터 묶음을 새 행으로만 넣는다 (복원은 빈 곳에만 하므로 불러오지 않는다).
// 칸은 Restored… 항목이 정한다. outbox에는 남기지 않는다.
export class VaultRestoreRepository {
  constructor(private readonly tx: Sql) {}

  /** 종류별로 있는 점의 수. 휴지통 것도 센다 (id와 주소를 차지한다). 끝날 때까지 새 점이 끼어들지 못하게 잠근다 */
  async existing(): Promise<ReadonlyMap<string, number>> {
    await this.tx`LOCK TABLE vault.nodes IN SHARE ROW EXCLUSIVE MODE`;
    const rows = await this.tx<(Pick<NodeRow, 'kind'> & { n: number })[]>`
      SELECT kind, count(*)::int AS n FROM vault.nodes GROUP BY kind`;
    return new Map(rows.map((r) => [r.kind, r.n]));
  }

  async saveCategory(spaceId: string, c: RestoredCategory): Promise<void> {
    await this.tx`INSERT INTO vault.nodes ${this.tx(c.nodeIn(spaceId) as never)}`;
    await this.tx`INSERT INTO vault.categories ${this.tx(c.rowIn(spaceId) as never)}`;
  }

  async saveWiki(spaceId: string, w: RestoredWiki): Promise<void> {
    await this.tx`INSERT INTO vault.nodes ${this.tx(w.nodeIn(spaceId) as never)}`;
    await this.tx`INSERT INTO vault.wikis ${this.tx(w.rowIn(spaceId) as never)}`;
    await this.tx`INSERT INTO vault.wiki_revisions ${this.tx(w.revision as never)}`;
  }

  /** wikiId: 대표 wiki 중 복원되는 것. 파일의 값과 다를 수 있다 */
  async saveSession(spaceId: string, s: RestoredSession, wikiId: string | null): Promise<void> {
    await this.tx`INSERT INTO vault.nodes ${this.tx(s.nodeIn(spaceId) as never)}`;
    await this.tx`INSERT INTO vault.sessions ${this.tx(s.rowIn(spaceId, wikiId) as never)}`;
    await this.tx`INSERT INTO vault.session_revisions ${this.tx(s.revision as never)}`;
  }

  async saveEdge(spaceId: string, e: RestoredEdge): Promise<void> {
    await this.tx`INSERT INTO vault.edges ${this.tx(e.rowIn(spaceId) as never)}`;
  }

  /** mainWikiId: 복원되는 wiki일 때만. 외래키가 있어 없는 wiki를 가리킬 수 없다 */
  async savePostMark(
    spaceId: string,
    m: RestoredPostMark,
    mainWikiId: string | null,
  ): Promise<void> {
    await this.tx`INSERT INTO vault.post_marks ${this.tx(m.rowIn(spaceId, mainWikiId) as never)}`;
  }

  /** 이름이 같은 그래프 보기가 있는 위치만 넣는다. 넣은 수를 돌려준다. 보기는 보관 파일에 없다 */
  async savePins(spaceId: string, pins: readonly RestoredPin[]): Promise<number> {
    if (pins.length === 0) return 0;
    const views = await this.tx<Pick<GraphViewRow, 'id' | 'name'>[]>`
      SELECT id, name FROM vault.graph_views WHERE space_id = ${spaceId}`;
    const byName = new Map(views.map((v) => [v.name, v.id]));
    let placed = 0;
    for (const pin of pins) {
      const view = byName.get(pin.view);
      if (!view) continue;
      const layout: NodeLayoutNew = {
        view_id: view,
        node_id: pin.node,
        x: pin.x,
        y: pin.y,
        pinned: true,
      };
      await this.tx`INSERT INTO vault.node_layout ${this.tx(layout as never)}`;
      placed += 1;
    }
    return placed;
  }
}
