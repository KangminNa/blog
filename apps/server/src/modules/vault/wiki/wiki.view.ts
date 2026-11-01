// wiki의 읽기 모양. 웹이 `import type`으로 가져오므로 아무것도 import하지 않는다 (객체설계 6장).

/** wiki 목록의 한 줄 */
export class WikiSummaryView {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly slug: string,
    readonly categoryId: string | null,
    readonly visibility: string,
    readonly origin: string,
    readonly revisionCount: number,
    readonly version: number,
    readonly updatedAt: Date,
  ) {}

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      slug: this.slug,
      categoryId: this.categoryId,
      visibility: this.visibility,
      origin: this.origin,
      revisionCount: this.revisionCount,
      version: this.version,
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /** 방문자에게 보이는 칸: 만든 쪽과 판 정보는 관리용이다 */
  toPublicJSON() {
    return {
      id: this.id,
      title: this.title,
      slug: this.slug,
      categoryId: this.categoryId,
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}

/** wiki 목록 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class WikiPageView {
  constructor(
    readonly wikis: readonly WikiSummaryView[],
    readonly next: string | null,
  ) {}

  toJSON() {
    return { wikis: this.wikis.map((w) => w.toJSON()), next: this.next };
  }

  toPublicJSON() {
    return { wikis: this.wikis.map((w) => w.toPublicJSON()), next: this.next };
  }
}

/** 본문의 칸 하나 */
export class WikiSectionView {
  constructor(
    readonly key: string,
    readonly title: string,
    readonly body: string,
  ) {}

  toJSON() {
    return { key: this.key, title: this.title, body: this.body };
  }
}

/** wiki 하나: 목록 정보 + 지금 판 본문 */
export class WikiDetailView {
  constructor(
    readonly summary: WikiSummaryView,
    readonly bodyMd: string,
    readonly sections: readonly WikiSectionView[],
    /** 사람이 고친 칸. AI가 바꾸려 하면 검토로 간다 */
    readonly pinnedSections: readonly string[],
  ) {}

  toJSON() {
    return {
      ...this.summary.toJSON(),
      bodyMd: this.bodyMd,
      sections: this.sections.map((s) => s.toJSON()),
      pinnedSections: this.pinnedSections,
    };
  }

  toPublicJSON() {
    return {
      ...this.summary.toPublicJSON(),
      bodyMd: this.bodyMd,
      sections: this.sections.map((s) => s.toJSON()),
    };
  }
}

/** 찾은 wiki 한 줄. 본문 조각은 찾은 말 둘레 (본문에 없고 제목에만 있으면 본문 앞부분) */
export class WikiHitView {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly categoryId: string | null,
    readonly updatedAt: Date,
    readonly excerpt: string,
  ) {}
}

/** 찾은 결과 한 쪽 */
export class WikiHitPageView {
  constructor(
    readonly hits: readonly WikiHitView[],
    readonly next: string | null,
  ) {}
}
