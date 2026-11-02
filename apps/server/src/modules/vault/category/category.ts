import { BaseEntity, type ColumnRules, DomainEvent, RuleViolation } from '../../platform';
import { type ChangeWork, GraphNode, type NewNode } from '../change/change-target';
import { SlugPolicy } from '../slug.policy';
import type { CategoryNew, CategoryRow } from '../vault.tables';
import { CategorySavedView } from './category.view';

/** categories 한 줄 + 점의 id와 휴지통 표시 (vault.nodes) */
export interface LoadedCategory extends CategoryRow {
  id: string;
  deleted_at: Date | null;
}

// 그래프 카테고리: 지도의 구역. 사람이 만들고 AI는 제안만 한다 (AI의 category.create는 검토로 간다).
// wiki가 남아 있으면 지울 수 없다 (부모를 지워도 자식은 지워지지 않는다).
export class Category extends GraphNode<LoadedCategory, NewNode<CategoryNew>> {
  static readonly NAME_MAX = 100;
  static readonly DESCRIPTION_MAX = 2_000;
  static readonly SORT_MAX = 1_000_000;
  private static readonly COLOR_MAX = 40;

  /** 사람이 정하는 칸과 그 규칙 */
  private static readonly RULES: ColumnRules<LoadedCategory> = {
    name: (value) => {
      const label = value.trim();
      if (!label) throw new RuleViolation('이름을 써 주세요');
      if (label.length > Category.NAME_MAX)
        throw new RuleViolation(`이름은 ${Category.NAME_MAX}자까지예요`);
      return label;
    },
    slug: (value) => SlugPolicy.check(value),
    color: (value) => {
      if (value !== null && value.length > Category.COLOR_MAX)
        throw new RuleViolation(`색은 ${Category.COLOR_MAX}자까지예요`);
      return value;
    },
    description: (value) => value,
    sort: (value) => value,
  };

  readonly targetKind = 'category';

  /** fields에 주소가 없으면 이름에서 만들고, 겹치면 번호를 붙인다 */
  static open(work: ChangeWork, fields: Partial<CategoryRow>): Category {
    const id = BaseEntity.newId();
    const category = new Category(
      {
        id,
        node_id: id,
        space_id: work.spaceId,
        name: '',
        slug: '',
        origin: work.origin,
        pinned: work.human,
      },
      true,
      fields.slug !== undefined,
    );
    category.edit({ name: '', ...fields });
    if (fields.slug === undefined)
      category.put('slug', SlugPolicy.fromTitle(category.row.name) || 'category');
    category.announce();
    return category;
  }

  static restore(row: LoadedCategory): Category {
    return new Category(row, false, true);
  }

  /** 사람이 고친 칸을 적는다 */
  edit(changes: Partial<CategoryRow>): void {
    this.accept(changes, Category.RULES);
  }

  /** 휴지통으로. 남은 wiki가 있는지는 Repository가 잠근 뒤 확인한다 (RESTRICT) */
  trash(work: ChangeWork): void {
    this.moveToTrash(work.now);
    this.announce();
  }

  /** 고친 것을 알린다. 칸을 edit로 바꾼 뒤 부른다 */
  announce(): void {
    this.record(
      new DomainEvent('vault.category.changed', 1, this.spaceId, {
        categoryId: this.id,
        name: this.row.name,
        deleted: this.gone,
      }),
    );
  }

  snapshot(): Readonly<Record<string, unknown>> {
    const { name, slug, color, description, sort } = this.row;
    return { version: this.version, name, slug, color, description, sort, deleted: this.gone };
  }

  rollBack(before: Readonly<Record<string, unknown>> | null, work: ChangeWork): void {
    if (before === null) {
      this.trash(work);
      return;
    }
    if (before.deleted) this.moveToTrash(work.now);
    else this.takeOutOfTrash();
    this.edit({
      name: String(before.name),
      slug: String(before.slug),
      color: before.color === null ? null : String(before.color),
      description: before.description === null ? null : String(before.description),
      sort: Number(before.sort),
    });
    this.announce();
  }

  savedView(changeSetId: string): CategorySavedView {
    return new CategorySavedView(this.row, changeSetId);
  }
}
