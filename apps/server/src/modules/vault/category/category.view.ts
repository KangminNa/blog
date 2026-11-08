import type { CategoryRow } from '../vault.tables';

// 그래프 카테고리의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다. 보는 사람마다 View가 다르고, Query가 고른다.

/** 카테고리 하나 (주인) */
export class CategoryView {
  constructor(private readonly row: Readonly<CategoryRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.node_id,
      name: r.name,
      slug: r.slug,
      color: r.color,
      description: r.description,
      sort: r.sort,
      origin: r.origin,
      version: r.version,
    };
  }
}

/** 방문자에게 보이는 카테고리 하나: 카테고리의 이름은 공개다. 분류 기준은 AI 정리용이다 */
export class PublicCategoryView {
  constructor(private readonly row: Readonly<CategoryRow>) {}

  toJSON() {
    const r = this.row;
    return { id: r.node_id, name: r.name, slug: r.slug, color: r.color, sort: r.sort };
  }
}

/** 카테고리 목록 (주인). 몇 개뿐이라 한 쪽에 다 보낸다 */
export class CategoryListView {
  constructor(private readonly categories: readonly CategoryView[]) {}

  toJSON() {
    return { categories: this.categories.map((c) => c.toJSON()), next: null };
  }
}

/** 방문자에게 보이는 카테고리 목록 */
export class PublicCategoryListView {
  constructor(private readonly categories: readonly PublicCategoryView[]) {}

  toJSON() {
    return { categories: this.categories.map((c) => c.toJSON()), next: null };
  }
}

/** 만들거나 고친 카테고리 하나 (주인). 화면은 이 version으로 다음 변경을 보낸다 */
export class CategorySavedView {
  constructor(
    private readonly row: Readonly<CategoryRow>,
    private readonly changeSetId: string,
  ) {}

  toJSON() {
    return { ...new CategoryView(this.row).toJSON(), changeSetId: this.changeSetId };
  }
}
