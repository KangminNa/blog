import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import type { CategoryRow } from '../vault.tables';
import {
  CategoryListView,
  CategoryView,
  PublicCategoryListView,
  PublicCategoryView,
} from './category.view';

// 카테고리 읽기. 이름은 공개라 방문자도 본다 (MVP 기획서 7장). 방문자는 공간을 모른다 (MVP는 공간 하나).
@Injectable()
export class CategoryQuery extends BaseQuery {
  /** 비공개까지 보는 요청자(주인)에게는 모든 칸, 그 밖에는 공개 칸만 */
  async list(actor: Actor): Promise<CategoryListView | PublicCategoryListView> {
    const rows = await this.sql<CategoryRow[]>`
      SELECT c.* FROM vault.categories c JOIN vault.nodes n ON n.id = c.node_id
      WHERE ${actor.spaceId === null ? this.sql`TRUE` : this.sql`c.space_id = ${actor.spaceId}`}
        AND n.deleted_at IS NULL
      ORDER BY c.sort, c.name, c.node_id`;
    return actor.canSeePrivate()
      ? new CategoryListView(rows.map((r) => new CategoryView(r)))
      : new PublicCategoryListView(rows.map((r) => new PublicCategoryView(r)));
  }
}
