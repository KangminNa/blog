import type { CategoryRow } from '../vault.tables';

// 그래프 카테고리의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다.

/** 카테고리 하나 */
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

  /** 방문자에게 보이는 칸: 카테고리의 이름은 공개다. 분류 기준은 AI 정리용이다 */
  toPublicJSON() {
    const r = this.row;
    return { id: r.node_id, name: r.name, slug: r.slug, color: r.color, sort: r.sort };
  }
}

/** 카테고리 목록. 몇 개뿐이라 한 쪽에 다 보낸다 */
export class CategoryListView {
  constructor(private readonly categories: readonly CategoryView[]) {}

  toJSON() {
    return { categories: this.categories.map((c) => c.toJSON()), next: null };
  }

  toPublicJSON() {
    return { categories: this.categories.map((c) => c.toPublicJSON()), next: null };
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
