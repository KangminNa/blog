// 그래프 카테고리의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** 카테고리 하나 */
export class CategoryView {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly slug: string,
    readonly color: string | null,
    readonly description: string | null,
    readonly sort: number,
    readonly origin: string,
    readonly version: number,
  ) {}

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      color: this.color,
      description: this.description,
      sort: this.sort,
      origin: this.origin,
      version: this.version,
    };
  }

  /** 방문자에게 보이는 칸: 카테고리의 이름은 공개다. 분류 기준은 AI 정리용이다 */
  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      color: this.color,
      sort: this.sort,
    };
  }
}

/** 카테고리 목록. 몇 개뿐이라 한 쪽에 다 보낸다 */
export class CategoryListView {
  constructor(readonly categories: readonly CategoryView[]) {}

  toJSON() {
    return { categories: this.categories.map((c) => c.toJSON()), next: null };
  }

  toPublicJSON() {
    return { categories: this.categories.map((c) => c.toPublicJSON()), next: null };
  }
}
