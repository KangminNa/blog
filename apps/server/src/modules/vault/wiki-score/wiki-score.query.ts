import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound } from '../../platform';
import { edges } from '../vault.schema';
import type { CategoryRow, WikiRow } from '../vault.tables';
import type { WikiIdInput } from '../wiki/wiki.input';
import {
  type ScoredWikiRow,
  WikiScore,
  WikiScorePolicy,
  type WikiUseRow,
} from './wiki-score.policy';
import {
  type WikiBasisRow,
  WikiScoreBoardView,
  WikiScoreDetailView,
  WikiScoreGroupView,
  type WikiScoreRow,
} from './wiki-score.view';

/** 점수표에 보이는 wiki 한 줄 */
type BoardWikiRow = ScoredWikiRow & Pick<WikiRow, 'title' | 'category_id' | 'visibility'>;

// wiki 점수 읽기 (docs/wiki점수.md). 점수는 표에 두지 않고 읽을 때 계산한다: 시간이 지나면 값이 계속 줄어서다.
// 주인만 본다. 비공개 세션 · wiki의 쓰임이 섞인 값이라 방문자에게 보이면 비공개가 드러난다 (원칙 5).
// 점수를 받는 것은 휴지통에 없는 wiki. 쓰임을 주는 것은 세션(대표 · 재료, 세션 하나에 한 번)과
// 글(대표 · 참고, 글 하나에 한 번), 그리고 더 새로운 wiki의 링크다.
@Injectable()
export class WikiScoreQuery extends BaseQuery {
  /** 카테고리별 순위와 히스토리 */
  async board(actor: Actor): Promise<WikiScoreBoardView> {
    actor.assertOwner();
    const space = actor.requireSpace();
    const [wikis, categories] = await Promise.all([this.wikis(space), this.categories(space)]);
    const scores = await this.scoresOf(space, wikis);
    const rows = this.rowsOf(wikis, scores);
    const ranked = rows.filter((r) => r.replaced_by === null);
    const live = new Set(categories.map((c) => c.node_id));
    const groups = [
      ...categories.map((c) => [c.node_id, c.name] as const),
      [null, null] as const,
    ].flatMap(([id, name]) => {
      const inGroup = ranked.filter((r) =>
        id === null ? r.category_id === null || !live.has(r.category_id) : r.category_id === id,
      );
      return inGroup.length === 0 ? [] : [new WikiScoreGroupView(id, name, inGroup)];
    });
    const history = rows.filter((r) => r.replaced_by !== null);
    return new WikiScoreBoardView(
      WikiScorePolicy.HALF_LIFE_DAYS,
      WikiScorePolicy.CITED,
      groups,
      history,
    );
  }

  /** wiki 하나의 점수와 물려받은 곳. 휴지통의 wiki는 없는 wiki와 같다 */
  async get(actor: Actor, req: WikiIdInput): Promise<WikiScoreDetailView> {
    actor.assertOwner();
    const space = actor.requireSpace();
    const wikis = await this.wikis(space);
    const scores = await this.scoresOf(space, wikis);
    const row = this.rowsOf(wikis, scores).find((r) => r.node_id === req.id);
    const score = scores.find((s) => s.wikiId === req.id);
    if (!row || !score) throw new NotFound('wiki를 찾을 수 없어요');
    const titles = new Map(wikis.map((w) => [w.node_id, w.title]));
    const bases: WikiBasisRow[] = score.bases.map((b) => ({
      wiki_id: b.wikiId,
      title: titles.get(b.wikiId) ?? '',
      ratio: b.ratio,
      amount: b.amount,
    }));
    return new WikiScoreDetailView(row, bases);
  }

  private async scoresOf(space: string, wikis: readonly BoardWikiRow[]): Promise<WikiScore[]> {
    const [uses, cites] = await Promise.all([this.uses(space), this.cites(space)]);
    return new WikiScorePolicy(new Date()).score(wikis, uses, cites);
  }

  /** 점수를 화면 값으로: 히스토리가 아닌 wiki 중 가장 높은 점수를 100으로, 순위는 점수가 높은 순 */
  private rowsOf(wikis: readonly BoardWikiRow[], scores: readonly WikiScore[]): WikiScoreRow[] {
    const byId = new Map(wikis.map((w) => [w.node_id, w]));
    const max = Math.max(0, ...scores.filter((s) => !s.history).map((s) => s.total));
    return [...scores].sort(WikiScore.byTotal).flatMap((s) => {
      const w = byId.get(s.wikiId);
      if (!w) return [];
      return [
        {
          node_id: w.node_id,
          title: w.title,
          category_id: w.category_id,
          visibility: w.visibility,
          shown: s.shown(max),
          total: s.total,
          accumulated: s.accumulated,
          inherited: s.inherited,
          uses: s.uses,
          last_used_at: s.lastUsedAt,
          replaced_by: s.replacedBy,
        },
      ];
    });
  }

  /** 점수를 받는 wiki: 휴지통에 없는 것 */
  private wikis(space: string) {
    return this.sql<BoardWikiRow[]>`
      SELECT w.node_id, w.title, w.category_id, w.visibility, w.created_at
      FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE w.space_id = ${space} AND n.deleted_at IS NULL
      ORDER BY w.node_id`;
  }

  private categories(space: string) {
    return this.sql<Pick<CategoryRow, 'node_id' | 'name'>[]>`
      SELECT c.node_id, c.name FROM vault.categories c JOIN vault.nodes n ON n.id = c.node_id
      WHERE c.space_id = ${space} AND n.deleted_at IS NULL
      ORDER BY c.sort, c.name, c.node_id`;
  }

  /**
   * wiki를 쓴 사건. 세션 하나 · 글 하나는 wiki 하나에 한 번만 센다 (대표이면서 재료 · 참고여도).
   * 세션의 날짜는 마지막 판, 글의 날짜는 글이 마지막으로 바뀐 때. 휴지통의 세션 · 글은 세지 않는다
   * (휴지통의 글은 대표가 비어 있다)
   */
  private uses(space: string) {
    return this.sql<WikiUseRow[]>`
      SELECT s.node_id AS by_id, s.wiki_id, COALESCE(s.last_revision_at, n.created_at) AS at
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${space} AND n.deleted_at IS NULL AND s.wiki_id IS NOT NULL
      UNION
      SELECT s.node_id, e.dst, COALESCE(s.last_revision_at, n.created_at)
      FROM vault.edges e
      JOIN vault.sessions s ON s.node_id = e.src
      JOIN vault.nodes n ON n.id = s.node_id
      WHERE e.space_id = ${space} AND e.kind = 'material' AND e.deleted_at IS NULL
        AND n.deleted_at IS NULL
      UNION
      SELECT p.post_id, w.wiki_id, p.updated_at
      FROM vault.post_marks p, unnest(p.main_wiki_id || p.ref_wiki_ids) AS w(wiki_id)
      WHERE p.space_id = ${space} AND p.main_wiki_id IS NOT NULL`;
  }

  /** wiki 사이의 근거: 지우지 않은 링크와 대체 */
  private cites(space: string) {
    return this.rows(
      edges,
      { space_id: space, deleted_at: null, kind: [WikiScorePolicy.LINK, WikiScorePolicy.REPLACES] },
      { columns: ['src', 'dst', 'kind', 'created_at'] },
    );
  }
}
