import type { WikiRow } from '../vault.tables';

// wiki 점수의 읽기 모양 (주인만). 웹이 `import type`으로 가져온다 (객체설계 6장).
// 점수는 표에 없고 읽을 때 계산한 값이라, wiki 한 줄에 계산한 칸을 더한 모양으로 받는다.

/** wiki 한 줄과 그 점수 (WikiScorePolicy가 계산한 값) */
export interface WikiScoreRow
  extends Pick<WikiRow, 'node_id' | 'title' | 'category_id' | 'visibility'> {
  /** 가장 높은 점수를 100으로 둔 값 */
  shown: number;
  /** 최종 점수 S = 쌓인 점수 + 물려받은 점수 */
  total: number;
  accumulated: number;
  inherited: number;
  /** 만든 날 말고 쓰인 횟수 */
  uses: number;
  last_used_at: Date;
  /** 이 wiki를 대체한 wiki (있으면 히스토리) */
  replaced_by: string | null;
}

/** 물려받은 몫 하나: 근거로 삼은 옛 wiki와 비율 β, 물려받은 값 */
export interface WikiBasisRow extends Pick<WikiRow, 'title'> {
  wiki_id: string;
  ratio: number;
  amount: number;
}

/** 소수 넷째 자리까지 (화면은 둘째 자리까지 쓴다) */
const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** 점수표의 wiki 한 줄 */
export class WikiScoreItemView {
  constructor(private readonly row: Readonly<WikiScoreRow>) {}

  toJSON() {
    const r = this.row;
    return {
      id: r.node_id,
      title: r.title,
      categoryId: r.category_id,
      visibility: r.visibility,
      score: r.shown,
      total: round(r.total),
      accumulated: round(r.accumulated),
      inherited: round(r.inherited),
      uses: r.uses,
      lastUsedAt: r.last_used_at.toISOString(),
      replacedBy: r.replaced_by,
    };
  }
}

/** 카테고리 하나의 순위. categoryId가 null이면 미분류 */
export class WikiScoreGroupView {
  constructor(
    private readonly categoryId: string | null,
    private readonly name: string | null,
    private readonly rows: readonly WikiScoreRow[],
  ) {}

  toJSON() {
    return {
      categoryId: this.categoryId,
      name: this.name,
      wikis: this.rows.map((r) => new WikiScoreItemView(r).toJSON()),
    };
  }
}

/**
 * 점수표: 카테고리별 순위(미분류는 끝에)와 히스토리(대체된 wiki, 순위에 넣지 않음).
 * 계산에 쓴 값(반감기 · β)도 함께 내보내 화면이 설명에 쓴다
 */
export class WikiScoreBoardView {
  constructor(
    private readonly halfLifeDays: number,
    private readonly cited: number,
    private readonly groups: readonly WikiScoreGroupView[],
    private readonly history: readonly WikiScoreRow[],
  ) {}

  toJSON() {
    return {
      halfLifeDays: this.halfLifeDays,
      cited: this.cited,
      groups: this.groups.map((g) => g.toJSON()),
      history: this.history.map((r) => new WikiScoreItemView(r).toJSON()),
    };
  }
}

/** wiki 하나의 점수와 어디서 얼마나 물려받았는지 */
export class WikiScoreDetailView {
  constructor(
    private readonly row: Readonly<WikiScoreRow>,
    private readonly bases: readonly WikiBasisRow[],
  ) {}

  toJSON() {
    return {
      wiki: new WikiScoreItemView(this.row).toJSON(),
      bases: this.bases.map((b) => ({
        wikiId: b.wiki_id,
        title: b.title,
        ratio: b.ratio,
        amount: round(b.amount),
      })),
    };
  }
}
