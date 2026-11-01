import { BaseRepository, type Row } from '../../platform';
import { BasketItem } from './basket';

// work.baskets + basket_items ↔ BasketItem. MVP는 공간마다 기본 상자 하나.
export class BasketRepository extends BaseRepository<BasketItem> {
  private static readonly DEFAULT_NAME = '소재';

  protected toEntity(row: Row): BasketItem {
    return BasketItem.restore(
      String(row.id),
      String(row.basket_id),
      String(row.kind),
      row.ref_id === null ? null : String(row.ref_id),
      row.url === null ? null : String(row.url),
      row.title === null ? null : String(row.title),
      row.note === null ? null : String(row.note),
      String(row.actor_type),
      row.actor_id === null ? null : String(row.actor_id),
      new Date(row.created_at),
    );
  }

  /**
   * 기본 상자의 id. 처음 쓸 때 만든다. 상자 표에는 공간마다 하나라는 제약이 없어서,
   * 처음 담는 요청이 동시에 와도 상자가 둘이 되지 않게 트랜잭션이 끝날 때까지 공간별 잠금을 잡는다.
   */
  async defaultBasket(spaceId: string): Promise<string> {
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`basket:${spaceId}`}, 0))`;
    const [found] = await this.sql`
      SELECT id FROM work.baskets
      WHERE space_id = ${spaceId} AND archived_at IS NULL
      ORDER BY id LIMIT 1`;
    if (found) return String(found.id);
    const [made] = await this.sql`
      INSERT INTO work.baskets (space_id, name)
      VALUES (${spaceId}, ${BasketRepository.DEFAULT_NAME})
      RETURNING id`;
    return String(made?.id);
  }

  /** 없으면 NotFound */
  async load(spaceId: string, id: string): Promise<BasketItem> {
    return this.one(await this.select(spaceId, id, false), '소재');
  }

  /** 지울 소재를 잠근다. 없으면 NotFound */
  async lock(spaceId: string, id: string): Promise<BasketItem> {
    return this.one(await this.select(spaceId, id, true), '소재');
  }

  async save(item: BasketItem): Promise<void> {
    await this.sql`
      INSERT INTO work.basket_items (id, basket_id, kind, ref_id, url, title, note, actor_type,
        actor_id, created_at)
      VALUES (${item.id}, ${item.basketId}, ${item.kind}, ${item.refId}, ${item.url}, ${item.title},
        ${item.note}, ${item.actorType}, ${item.actorId}, ${item.createdAt})`;
    await this.publishEvents(item);
  }

  async remove(item: BasketItem): Promise<void> {
    await this.sql`DELETE FROM work.basket_items WHERE id = ${item.id}`;
  }

  private select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT i.* FROM work.basket_items i JOIN work.baskets b ON b.id = i.basket_id
      WHERE i.id = ${id} AND b.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF i` : this.sql``}`;
  }
}
