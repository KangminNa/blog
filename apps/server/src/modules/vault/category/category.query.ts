import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, type Row } from '../../platform';
import { CategoryListView, CategoryView } from './category.view';

// 카테고리 읽기. 이름은 공개라 방문자도 본다 (MVP 기획서 7장). 방문자는 공간을 모른다 (MVP는 공간 하나).
@Injectable()
export class CategoryQuery extends BaseQuery {
  async list(actor: Actor): Promise<CategoryListView> {
    const rows = await this.sql`
      SELECT c.* FROM vault.categories c JOIN vault.nodes n ON n.id = c.node_id
      WHERE ${actor.spaceId === null ? this.sql`TRUE` : this.sql`c.space_id = ${actor.spaceId}`}
        AND n.deleted_at IS NULL
      ORDER BY c.sort, c.name, c.node_id`;
    return new CategoryListView(rows.map((r) => CategoryQuery.view(r)));
  }

  private static view(r: Row): CategoryView {
    return new CategoryView(
      String(r.node_id),
      String(r.name),
      String(r.slug),
      r.color === null ? null : String(r.color),
      r.description === null ? null : String(r.description),
      Number(r.sort),
      String(r.origin),
      Number(r.version),
    );
  }
}
