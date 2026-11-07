import type { WikiRevisionRow, WikiRow } from '../vault.tables';

// wiki의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다. AI에게 주는 답은 snake_case다.

/** wiki 한 줄과 지금 판의 본문 (wiki_revisions의 body_md · sections) */
export type WikiDetailRow = WikiRow & Pick<WikiRevisionRow, 'body_md' | 'sections'>;

/** 찾은 wiki 한 줄을 읽는 칸 */
export interface WikiHitRow
  extends Pick<WikiRow, 'node_id' | 'title' | 'category_id' | 'updated_at'> {
  excerpt: string | null;
}

/** wiki 목록의 한 줄 */
export class WikiSummaryView {
  constructor(private readonly row: Readonly<WikiRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.node_id,
      title: r.title,
      slug: r.slug,
      categoryId: r.category_id,
      visibility: r.visibility,
      origin: r.origin,
      revisionCount: r.revision_count,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
    };
  }

  /** 방문자에게 보이는 칸: 만든 쪽과 판 정보는 관리용이다 */
  toPublicJSON() {
    const r = this.row;
    return {
      id: r.node_id,
      title: r.title,
      slug: r.slug,
      categoryId: r.category_id,
      updatedAt: r.updated_at.toISOString(),
    };
  }
}

/** wiki 목록 한 쪽. next가 있으면 그 값으로 다음 쪽을 부른다 */
export class WikiPageView {
  constructor(
    private readonly wikis: readonly WikiSummaryView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { wikis: this.wikis.map((w) => w.toJSON()), next: this.next };
  }

  toPublicJSON() {
    return { wikis: this.wikis.map((w) => w.toPublicJSON()), next: this.next };
  }
}

/** wiki 하나: 목록 정보 + 지금 판 본문 */
export class WikiDetailView {
  constructor(private readonly row: Readonly<WikiDetailRow>) {}

  toJSON() {
    return {
      ...new WikiSummaryView(this.row).toJSON(),
      bodyMd: this.row.body_md,
      sections: this.sections,
      /** 사람이 고친 칸. AI가 바꾸려 하면 검토로 간다 */
      pinnedSections: this.row.pinned_sections,
    };
  }

  toPublicJSON() {
    return {
      ...new WikiSummaryView(this.row).toPublicJSON(),
      bodyMd: this.row.body_md,
      sections: this.sections,
    };
  }

  /** 본문의 칸들 (## 제목 단위). 판의 sections 칸에 적힌 그대로 */
  private get sections() {
    const sections = (this.row.sections ?? []) as readonly {
      key: string;
      title: string;
      body: string;
    }[];
    return sections.map(({ key, title, body }) => ({ key, title, body }));
  }
}

/** get_wiki의 답 (AI에게). version은 고칠 때 base_version으로 쓴다 */
export class ToolWikiView {
  constructor(private readonly row: Readonly<WikiDetailRow>) {}

  toJSON() {
    const r = this.row;
    return {
      wiki_id: r.node_id,
      title: r.title,
      slug: r.slug,
      category_id: r.category_id,
      version: r.version,
      revision: r.revision_count,
      updated_at: r.updated_at.toISOString(),
      pinned_sections: r.pinned_sections,
      sections: new WikiDetailView(r).toJSON().sections,
      body_md: r.body_md,
    };
  }
}

/** 만들거나 고친 wiki 하나 (주인). 조회 모양 + 남은 변경 묶음. 화면은 이 version으로 다음 변경을 보낸다 */
export class WikiSavedView {
  constructor(
    private readonly row: Readonly<WikiDetailRow>,
    private readonly changeSetId: string,
  ) {}

  toJSON() {
    return { ...new WikiDetailView(this.row).toJSON(), changeSetId: this.changeSetId };
  }
}

/** 찾은 wiki 한 줄 (AI에게). 본문 조각은 찾은 말 둘레 (본문에 없고 제목에만 있으면 본문 앞부분) */
export class WikiHitView {
  constructor(private readonly row: Readonly<WikiHitRow>) {}

  toJSON() {
    const r = this.row;
    return {
      wiki_id: r.node_id,
      title: r.title,
      category_id: r.category_id,
      date: r.updated_at.toISOString(),
      excerpt: (r.excerpt ?? '').replace(/\s+/g, ' ').trim(),
    };
  }
}

/** search_wikis의 답 (AI에게). 어떤 wiki를 읽을지 고를 만큼만 짧게 */
export class WikiHitPageView {
  constructor(
    private readonly hits: readonly WikiHitView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { wikis: this.hits.map((h) => h.toJSON()), next: this.next };
  }
}
