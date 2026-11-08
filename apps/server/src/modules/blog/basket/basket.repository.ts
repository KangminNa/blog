import { TableRepository } from '../../platform';
import { basketItems, baskets } from '../blog.schema';
import type { BasketItemRow, BasketRow } from '../blog.tables';
import { BasketItem } from './basket';

// work.baskets + basket_items ↔ BasketItem. MVP는 공간마다 기본 상자 하나.
// 불러오기와 저장은 기반이 하고, 여기에는 상자를 찾고 소재를 지우는 SQL만 있다.
export class BasketRepository extends TableRepository<BasketItemRow, BasketItem> {
  private static readonly DEFAULT_NAME = '소재';

  protected readonly table = basketItems;
  protected readonly noun = '소재';

  protected toEntity(row: BasketItemRow): BasketItem {
    return BasketItem.restore(row);
  }

  /**
   * 기본 상자의 id. 처음 쓸 때 만든다. 상자 표에는 공간마다 하나라는 제약이 없어서,
   * 처음 담는 요청이 동시에 와도 상자가 둘이 되지 않게 트랜잭션이 끝날 때까지 공간별 잠금을 잡는다.
   */
  async defaultBasket(spaceId: string): Promise<string> {
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`basket:${spaceId}`}, 0))`;
    const found = await this.row(
      baskets,
      { space_id: spaceId, archived_at: null },
      { columns: ['id'], order: ['id'], limit: 1 },
    );
    if (found) return found.id;
    const basket = { space_id: spaceId, name: BasketRepository.DEFAULT_NAME };
    const [made] = await this.sql<Pick<BasketRow, 'id'>[]>`
      INSERT INTO work.baskets ${this.sql(basket)} RETURNING id`;
    return String(made?.id);
  }

  async remove(item: BasketItem): Promise<void> {
    await this.deleteRows(basketItems, { id: item.id });
  }

  /** 소재는 상자를 거쳐 공간에 속한다 */
  protected override select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT i.* FROM work.basket_items i JOIN work.baskets b ON b.id = i.basket_id
      WHERE i.id = ${id} AND b.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF i` : this.sql``}`;
  }
}
