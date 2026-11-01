import type { Sql } from '../../platform';
import type { Category } from '../category/category';
import { CategoryRepository } from '../category/category.repository';
import type { Edge } from '../edge/edge';
import { EdgeRepository } from '../edge/edge.repository';
import type { Session } from '../session/session';
import { SessionRepository } from '../session/session.repository';
import type { Wiki } from '../wiki/wiki';
import { WikiRepository } from '../wiki/wiki.repository';
import { type ChangeOp, TargetBoard } from './change-op';
import type { ChangeTarget } from './change-target';

// 변경 묶음이 건드리는 네 묶음(세션 · wiki · 카테고리 · 선)의 Repository를 한 트랜잭션에서 함께 쓴다.
// ChangeService만 쓴다 (객체설계 4장 예외). 대상은 언제나 종류, 그다음 id 순서로 잠가 서로 기다리다 멈추지 않는다.
export class TargetRepository {
  private readonly sessions: SessionRepository;
  private readonly wikis: WikiRepository;
  private readonly categories: CategoryRepository;
  private readonly edges: EdgeRepository;

  constructor(
    tx: Sql,
    private readonly spaceId: string,
  ) {
    this.sessions = new SessionRepository(tx);
    this.wikis = new WikiRepository(tx);
    this.categories = new CategoryRepository(tx);
    this.edges = new EdgeRepository(tx);
  }

  /** 변경들이 건드릴 대상을 정해진 순서로 잠근다. 없는 대상은 자리만 비어 있다 */
  async lock(ops: readonly ChangeOp[]): Promise<TargetBoard> {
    const board = new TargetBoard(await this.edges.kinds());
    const places = [...new Set(ops.flatMap((op) => op.places(board)))].sort();
    for (const place of places) board.put(place, await this.lockAt(place));
    const nodes = [...new Set(ops.flatMap((op) => op.nodes()))];
    board.markLive(await this.edges.liveNodes(this.spaceId, nodes));
    return board;
  }

  private lockAt(place: string): Promise<ChangeTarget | null> {
    const [kind = '', id = '', dst, edgeKind] = place.split(':');
    if (kind === 'category') return this.categories.lock(this.spaceId, id);
    if (kind === 'session') return this.sessions.lock(this.spaceId, id);
    if (kind === 'wiki') return this.wikis.lock(this.spaceId, id);
    return dst && edgeKind
      ? this.edges.lockAt(id, dst, edgeKind)
      : this.edges.lock(this.spaceId, id);
  }

  /** 대상을 저장한다. 새 wiki·카테고리는 여기서 겹치지 않는 주소를 정한다 */
  async save(target: ChangeTarget): Promise<void> {
    if (target.targetKind === 'wiki') {
      const wiki = target as Wiki;
      if (wiki.isNew) wiki.settleSlug(await this.wikis.takenSlugs(this.spaceId, wiki.slug));
      return this.wikis.save(wiki);
    }
    if (target.targetKind === 'category') {
      const category = target as Category;
      if (category.isNew)
        category.settleSlug(await this.categories.takenSlugs(this.spaceId, category.slug));
      return this.categories.save(category);
    }
    if (target.targetKind === 'session') return this.sessions.save(target as Session);
    return this.edges.save(target as Edge);
  }
}
