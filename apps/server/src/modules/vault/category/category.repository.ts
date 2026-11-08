import { Conflict } from '../../platform';
import { GraphNodeRepository } from '../change/change-target.repository';
import { categories } from '../vault.schema';
import { Category, type LoadedCategory } from './category';

// vault.nodes(카테고리) + categories ↔ Category. 휴지통은 nodes.deleted_at.
export class CategoryRepository extends GraphNodeRepository<LoadedCategory, Category> {
  protected readonly table = categories;
  protected readonly noun = '카테고리';
  protected readonly kind = 'category';
  protected readonly slugKey = 'categories_space_id_slug_key';

  protected toEntity(row: LoadedCategory): Category {
    return Category.restore(row);
  }

  /** 카테고리 한 줄과 휴지통 표시. 휴지통의 카테고리도 읽는다 */
  protected override select(spaceId: string, id: string, lock: boolean) {
    return this.sql`
      SELECT c.*, c.node_id AS id, n.deleted_at
      FROM vault.categories c JOIN vault.nodes n ON n.id = c.node_id
      WHERE c.node_id = ${id} AND c.space_id = ${spaceId}
      ${lock ? this.sql`FOR UPDATE OF c` : this.sql``}`;
  }

  protected override async saveParts(category: Category): Promise<void> {
    if (category.trashChange && category.gone) await this.assertEmpty(category);
    await super.saveParts(category);
  }

  /** 지우기 규칙: wiki가 남은 카테고리는 지우지 않는다 (RESTRICT). 대표를 옮기는 쪽도 이 행을 잠그므로 끼어들지 못한다 */
  private async assertEmpty(category: Category): Promise<void> {
    const [row] = await this.sql`
      SELECT 1 AS found FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE w.category_id = ${category.id} AND n.deleted_at IS NULL LIMIT 1`;
    if (row) throw new Conflict('wiki가 남아 있어요. 먼저 다른 카테고리로 옮겨 주세요');
  }
}
