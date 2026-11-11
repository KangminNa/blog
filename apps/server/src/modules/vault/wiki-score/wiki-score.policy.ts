import type { EdgeRow, WikiRow } from '../vault.tables';

// wiki 점수 (docs/wiki점수.md). 입력 → 판단: DB를 모르고, 같은 입력과 같은 오늘이면 늘 같은 점수다.
//   쌓인 점수  A_i = Σ 2^-((t - t_e) / H)                       만든 날 + 더 새로운 것이 근거로 삼은 날
//   최종 점수  S_i = A_i + Σ β_ij · (A_j - 2^-((t - t_ij) / H))  근거로 삼은 옛 wiki j에게서 물려받음
// 빼는 값은 i가 j에게 준 1점이 지금 남은 값이다 (링크만 걸어서 점수가 오르지 않게).
// β는 근거로 삼음 ½, 대체함 1, j가 다른 wiki에게 대체되어 히스토리면 0. 물려받은 점수까지 다시 물려받지는 않는다.
// 세션 · 글은 점수를 받지 않고 쓰임만 준다. 카테고리는 분류일 뿐 쓰임이 아니다.

/** 점수를 받는 wiki: 휴지통에 없는 것 */
export type ScoredWikiRow = Pick<WikiRow, 'node_id' | 'created_at'>;

/** wiki를 쓴 사건 하나 (세션 하나 · 글 하나). 날짜는 세션의 마지막 판, 글이 마지막으로 바뀐 때 */
export interface WikiUseRow {
  wiki_id: string;
  at: Date;
}

/** wiki 사이의 선: 링크(나중에 만든 쪽이 근거로 삼음)와 대체(src가 dst를 대체). 날짜는 선이 생긴 날 */
export type WikiCiteRow = Pick<EdgeRow, 'src' | 'dst' | 'kind' | 'created_at'>;

/** 물려받은 몫 하나: 근거로 삼은 옛 wiki, 비율 β, 물려받은 값 */
export class WikiBasis {
  constructor(
    readonly wikiId: string,
    readonly ratio: number,
    readonly amount: number,
  ) {}

  /** 근거가 히스토리라 물려받지 않는다 (β = 0) */
  get gone(): boolean {
    return this.ratio === 0;
  }
}

/** wiki 하나의 점수. 화면은 가장 높은 점수를 100으로 바꿔 보여 준다 */
export class WikiScore {
  constructor(
    readonly wikiId: string,
    /** 쌓인 점수 A */
    readonly accumulated: number,
    /** 물려받은 점수 Σ β(A_j − 내 몫) */
    readonly inherited: number,
    /** 만든 날 말고 쓰인 횟수 (세션 · 글 · 더 새로운 wiki) */
    readonly uses: number,
    /** 마지막으로 쓰인 때 (쓰인 적이 없으면 만든 때) */
    readonly lastUsedAt: Date,
    /** 이 wiki를 대체한 wiki. 있으면 히스토리라 순위에 넣지 않는다 */
    readonly replacedBy: string | null,
    readonly bases: readonly WikiBasis[],
  ) {}

  /** 최종 점수 S */
  get total(): number {
    return this.accumulated + this.inherited;
  }

  get history(): boolean {
    return this.replacedBy !== null;
  }

  /** 가장 높은 점수를 100으로 둔 값 */
  shown(max: number): number {
    return max > 0 ? Math.round((100 * this.total) / max) : 0;
  }

  /** 점수가 높은 순, 같으면 나중에 만든 wiki(UUIDv7) 먼저 */
  static byTotal(this: void, a: WikiScore, b: WikiScore): number {
    return b.total - a.total || (a.wikiId < b.wikiId ? 1 : a.wikiId > b.wikiId ? -1 : 0);
  }
}

/** 근거 하나: citer가 cited를 근거로 삼은 날, 대체인지 */
class Citation {
  constructor(
    readonly citer: string,
    readonly cited: string,
    readonly at: Date,
    readonly replaces: boolean,
  ) {}
}

export class WikiScorePolicy {
  /** 반감기 H */
  static readonly HALF_LIFE_DAYS = 90;
  /** 근거로 삼았을 때 물려받는 비율 β (처음 값. 운영하면서 0과 1 사이에서 조정한다) */
  static readonly CITED = 0.5;
  /** 대체했을 때 물려받는 비율 */
  static readonly REPLACED = 1;
  /** 이 점수 아래면 지울 만한 wiki 후보: 아무도 쓰지 않은 wiki의 처음 1점이 반감기 세 번(270일) 지난 값 */
  static readonly STALE_BELOW = 0.125;
  /** wiki ↔ wiki 링크 (방향 없음: 나중에 만든 쪽이 근거로 삼은 것) */
  static readonly LINK = 'link';
  /** 새 wiki → 옛 wiki 대체 */
  static readonly REPLACES = 'replaces';
  private static readonly DAY_MS = 86_400_000;

  constructor(
    private readonly now: Date,
    private readonly cited: number = WikiScorePolicy.CITED,
  ) {}

  score(
    wikis: readonly ScoredWikiRow[],
    uses: readonly WikiUseRow[],
    cites: readonly WikiCiteRow[],
  ): WikiScore[] {
    const born = new Map(wikis.map((w) => [w.node_id, w.created_at]));
    const events = new Map<string, Date[]>(wikis.map((w) => [w.node_id, [w.created_at]]));
    for (const use of uses) events.get(use.wiki_id)?.push(use.at);
    const citations = this.citations(cites, born);
    for (const c of citations) events.get(c.cited)?.push(c.at);

    const replacedBy = new Map(
      citations.filter((c) => c.replaces).map((c) => [c.cited, c.citer] as const),
    );
    const accumulated = new Map(
      [...events].map(([id, dates]) => [id, dates.reduce((sum, at) => sum + this.left(at), 0)]),
    );
    const bases = new Map<string, WikiBasis[]>();
    for (const c of citations) {
      const ratio = c.replaces
        ? WikiScorePolicy.REPLACED
        : replacedBy.has(c.cited)
          ? 0
          : this.cited;
      const before = Math.max(0, (accumulated.get(c.cited) ?? 0) - this.left(c.at));
      const list = bases.get(c.citer) ?? [];
      list.push(new WikiBasis(c.cited, ratio, ratio * before));
      bases.set(c.citer, list);
    }

    return wikis.map((w) => {
      const id = w.node_id;
      const dates = events.get(id) ?? [w.created_at];
      const from = bases.get(id) ?? [];
      return new WikiScore(
        id,
        accumulated.get(id) ?? 0,
        from.reduce((sum, b) => sum + b.amount, 0),
        dates.length - 1,
        new Date(Math.max(...dates.map((d) => d.getTime()))),
        replacedBy.get(id) ?? null,
        from,
      );
    });
  }

  /** 1점이 지금 남은 값 2^-((t - at) / H) */
  private left(at: Date): number {
    const days = (this.now.getTime() - at.getTime()) / WikiScorePolicy.DAY_MS;
    return 2 ** (-days / WikiScorePolicy.HALF_LIFE_DAYS);
  }

  /**
   * 점수를 받는 wiki 사이의 근거. 두 wiki 사이에는 근거 하나만 센다 (링크와 대체가 함께 있으면 대체).
   * 링크는 방향이 없어 나중에 만든 쪽(같으면 id가 큰 쪽)이 근거로 삼은 것이다
   */
  private citations(
    cites: readonly WikiCiteRow[],
    born: ReadonlyMap<string, Date>,
  ): readonly Citation[] {
    const pairs = new Map<string, Citation>();
    for (const edge of cites) {
      const [src, dst] = [born.get(edge.src), born.get(edge.dst)];
      if (!src || !dst || edge.src === edge.dst) continue;
      const replaces = edge.kind === WikiScorePolicy.REPLACES;
      if (!replaces && edge.kind !== WikiScorePolicy.LINK) continue;
      const srcIsNewer = src.getTime() !== dst.getTime() ? src > dst : edge.src > edge.dst;
      const [citer, cited] = replaces || srcIsNewer ? [edge.src, edge.dst] : [edge.dst, edge.src];
      const key = `${citer} ${cited}`;
      const seen = pairs.get(key);
      if (seen && (seen.replaces || !replaces)) continue;
      pairs.set(key, new Citation(citer, cited, edge.created_at, replaces));
    }
    return [...pairs.values()];
  }
}
