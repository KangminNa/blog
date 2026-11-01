import { BaseRepository, Conflict, Database, type Row } from '../../platform';
import { Category } from './category';

// vault.nodes(카테고리) + categories ↔ Category. 휴지통은 nodes.deleted_at.
export class CategoryRepository extends BaseRepository<Category> {
  protected toEntity(row: Row): Category {
    return Category.restore(
      String(row.node_id),
      Number(row.version),
      String(row.space_id),
      String(row.name),
      String(row.slug),
      row.color === null ? null : String(row.color),
      row.description === null ? null : String(row.description),
      Number(row.sort),
      String(row.origin),
      Boolean(row.pinned),
      row.deleted_at === null ? null : new Date(row.deleted_at),
    );
  }

  /** 고칠 카테고리를 잠근다 (휴지통 포함). 없으면 null */
  async lock(spaceId: string, id: string): Promise<Category | null> {
    return this.maybeOne(
      await this.sql`
        SELECT c.*, n.deleted_at
        FROM vault.categories c JOIN vault.nodes n ON n.id = c.node_id
        WHERE c.node_id = ${id} AND c.space_id = ${spaceId}
        FOR UPDATE OF c`,
    );
  }

  /** 이 주소이거나 "이 주소-숫자"인 카테고리의 주소들 (휴지통 포함) */
  async takenSlugs(spaceId: string, base: string): Promise<Set<string>> {
    const rows = await this.sql`
      SELECT slug FROM vault.categories
      WHERE space_id = ${spaceId} AND (slug = ${base} OR slug LIKE ${`${base}-%`})`;
    return new Set(rows.map((r) => String(r.slug)));
  }

  async save(category: Category): Promise<void> {
    try {
      if (category.isNew) {
        await this.insert(category);
        category.markInserted();
      } else if (category.changed) {
        // 휴지통만 오갔으면 바뀐 열이 없다. version은 늘 올린다
        const columns = { ...category.changes, version: category.version + 1 };
        const result = await this.sql`
          UPDATE vault.categories SET ${this.sql(columns)}
          WHERE node_id = ${category.id} AND version = ${category.version}`;
        this.expectUpdated(result.count, category);
      }
    } catch (error) {
      if (Database.isUniqueViolation(error, 'categories_space_id_slug_key'))
        throw new Conflict('이미 쓰는 주소예요 (휴지통 포함)');
      throw error;
    }
    if (category.trashChanged) {
      if (category.gone) await this.assertEmpty(category);
      await this.sql`
        UPDATE vault.nodes SET deleted_at = ${category.deletedAt}, purge_after = ${category.purgeAfter}
        WHERE id = ${category.id}`;
      category.trashSaved();
    }
    category.clearChanges();
    await this.publishEvents(category);
  }

  private async insert(category: Category): Promise<void> {
    await this.sql`
      INSERT INTO vault.nodes (id, space_id, kind)
      VALUES (${category.id}, ${category.spaceId}, 'category')`;
    await this.sql`
      INSERT INTO vault.categories (node_id, space_id, name, slug, color, description, sort, origin, pinned)
      VALUES (${category.id}, ${category.spaceId}, ${category.name}, ${category.slug}, ${category.color},
        ${category.description}, ${category.sort}, ${category.origin}, ${category.pinned})`;
  }

  /** 지우기 규칙: wiki가 남은 카테고리는 지우지 않는다 (RESTRICT). 대표를 옮기는 쪽도 이 행을 잠그므로 끼어들지 못한다 */
  private async assertEmpty(category: Category): Promise<void> {
    const [row] = await this.sql`
      SELECT 1 AS found FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE w.category_id = ${category.id} AND n.deleted_at IS NULL LIMIT 1`;
    if (row) throw new Conflict('wiki가 남아 있어요. 먼저 다른 카테고리로 옮겨 주세요');
  }
}
