import type { WikiRow } from '../vault.tables';

// wiki의 읽기 모양. 웹이 `import type`으로 가져온다 (객체설계 6장).
// 표의 칸 중 무엇을 내보내는지는 여기 한 곳에만 적는다. 방문자가 보는 칸은 Public으로 시작하는 View에 따로 있다:
// 만든 쪽, 판 정보, 사람이 고친 칸은 관리용이다. AI에게 주는 답은 snake_case다.

/** 본문의 칸 하나 */
export interface WikiSectionRow {
  key: string;
  title: string;
  body: string;
}

/** wiki 하나를 읽는 모양: 표 한 줄 + 지금 판의 본문과 칸 */
export interface WikiDetailRow extends WikiRow {
  body_md: string;
  sections: readonly WikiSectionRow[];
}

/** 찾은 wiki 한 줄을 읽는 칸 */
export interface WikiHitRow
  extends Pick<WikiRow, 'node_id' | 'title' | 'category_id' | 'updated_at'> {
  excerpt: string | null;
}

function sectionsOf(row: Readonly<WikiDetailRow>) {
  return row.sections.map((s) => ({ key: s.key, title: s.title, body: s.body }));
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
}

/** 방문자가 보는 wiki 목록의 한 줄 */
export class PublicWikiSummaryView {
  constructor(private readonly row: Readonly<WikiRow>) {}

  toJSON() {
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
}

/** 방문자가 보는 wiki 목록 한 쪽 */
export class PublicWikiPageView {
  constructor(
    private readonly wikis: readonly PublicWikiSummaryView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { wikis: this.wikis.map((w) => w.toJSON()), next: this.next };
  }
}

/** wiki 하나: 목록 정보 + 지금 판 본문 + 사람이 고친 칸(AI가 바꾸려 하면 검토로 간다) */
export class WikiDetailView {
  constructor(private readonly row: Readonly<WikiDetailRow>) {}

  toJSON() {
    const r = this.row;
    return {
      ...new WikiSummaryView(r).toJSON(),
      bodyMd: r.body_md,
      sections: sectionsOf(r),
      pinnedSections: r.pinned_sections,
    };
  }
}

/** 방문자가 보는 wiki 하나 */
export class PublicWikiDetailView {
  constructor(private readonly row: Readonly<WikiDetailRow>) {}

  toJSON() {
    const r = this.row;
    return {
      ...new PublicWikiSummaryView(r).toJSON(),
      bodyMd: r.body_md,
      sections: sectionsOf(r),
    };
  }
}

/** 만들거나 고친 wiki 하나 (주인). 조회 모양 + 남은 변경 묶음. 화면은 이 version으로 다음 변경을 보낸다 */
export class WikiSavedView extends WikiDetailView {
  constructor(
    row: Readonly<WikiDetailRow>,
    private readonly changeSetId: string,
  ) {
    super(row);
  }

  override toJSON() {
    return { ...super.toJSON(), changeSetId: this.changeSetId };
  }
}

/** get_wiki 결과 (AI에게). version은 고칠 때 base_version으로 쓴다 */
export class WikiNoteView {
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
      sections: sectionsOf(r),
      body_md: r.body_md,
    };
  }
}

/** 찾은 wiki 한 줄. 본문 조각은 찾은 말 둘레 (본문에 없고 제목에만 있으면 본문 앞부분) */
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

/** search_wikis 결과 (AI에게). 어떤 wiki를 읽을지 고를 만큼만 짧게 */
export class WikiHitPageView {
  constructor(
    private readonly hits: readonly WikiHitView[],
    private readonly next: string | null,
  ) {}

  toJSON() {
    return { wikis: this.hits.map((h) => h.toJSON()), next: this.next };
  }
}
