import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, NotFound } from '../../platform';
import type { WikiRow } from '../vault.tables';
import { ListWikisInput, type SearchWikisInput, type WikiIdInput } from './wiki.input';
import {
  PublicWikiDetailView,
  PublicWikiPageView,
  PublicWikiSummaryView,
  ToolWikiView,
  type WikiDetailRow,
  WikiDetailView,
  WikiHitPageView,
  type WikiHitRow,
  WikiHitView,
  WikiPageView,
  WikiSummaryView,
} from './wiki.view';

// wiki 읽기. 공개 범위는 SQL에서 먼저 거른 뒤 쪽을 나눈다: 볼 수 없는 wiki는 결과·조각·next 어디에도 영향을 주지 않고,
// 하나를 열면 없는 wiki와 똑같이 NotFound다. 순서는 바뀌지 않는 wiki id(UUIDv7) 내림차순.
// 방문자는 공간을 모른다 (MVP는 공간 하나).
@Injectable()
export class WikiQuery extends BaseQuery {
  private static readonly PAGE = 30;
  /** 찾은 결과의 본문 조각: 전체 길이, 그중 찾은 말 앞에 남길 길이 */
  private static readonly EXCERPT = 160;
  private static readonly EXCERPT_LEAD = 40;

  /** 비공개까지 보는 요청자(주인)에게는 모든 칸, 그 밖에는 공개 칸만 */
  async list(actor: Actor, req: ListWikisInput): Promise<WikiPageView | PublicWikiPageView> {
    const rows = await this.sql<WikiRow[]>`
      SELECT w.* FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE ${this.inSpace(actor)} AND n.deleted_at IS NULL ${this.visibleTo(actor, 'w.visibility')}
        ${this.matching(req.words)}
        ${req.categoryId === null ? this.sql`` : this.sql`AND w.category_id = ${req.categoryId}`}
        ${req.before === null ? this.sql`` : this.sql`AND w.node_id < ${req.before}`}
      ORDER BY w.node_id DESC
      LIMIT ${WikiQuery.PAGE + 1}`;
    const { items, next } = this.pageOf(rows, WikiQuery.PAGE, (last) =>
      ListWikisInput.cursorAfter(last.node_id),
    );
    return actor.canSeePrivate()
      ? new WikiPageView(
          items.map((r) => new WikiSummaryView(r)),
          next,
        )
      : new PublicWikiPageView(
          items.map((r) => new PublicWikiSummaryView(r)),
          next,
        );
  }

  /** 볼 수 없는 wiki는 없는 wiki와 똑같이 NotFound. 주인에게는 모든 칸, 그 밖에는 공개 칸만 */
  async get(actor: Actor, req: WikiIdInput): Promise<WikiDetailView | PublicWikiDetailView> {
    const row = await this.find(actor, req.id);
    return actor.canSeePrivate() ? new WikiDetailView(row) : new PublicWikiDetailView(row);
  }

  /** 키워드로 찾기 (AI 도구의 search_wikis). 제목과 지금 판의 본문에서 찾는다 (pg_bigm: 대소문자 구분) */
  async search(actor: Actor, req: SearchWikisInput): Promise<WikiHitPageView> {
    WikiQuery.assertCanRead(actor);
    const [lead = ''] = req.words;
    const rows = await this.sql<WikiHitRow[]>`
      SELECT w.node_id, w.title, w.category_id, w.updated_at,
             substr(w.head_text,
                    greatest(position(${lead} in w.head_text) - ${WikiQuery.EXCERPT_LEAD}, 1),
                    ${WikiQuery.EXCERPT}) AS excerpt
      FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE ${this.inSpace(actor)} AND n.deleted_at IS NULL ${this.visibleTo(actor, 'w.visibility')}
        ${this.matching(req.words)}
        ${req.before === null ? this.sql`` : this.sql`AND w.node_id < ${req.before}`}
      ORDER BY w.node_id DESC
      LIMIT ${req.limit + 1}`;
    const { items, next } = this.pageOf(rows, req.limit, (last) =>
      ListWikisInput.cursorAfter(last.node_id),
    );
    return new WikiHitPageView(
      items.map((r) => new WikiHitView(r)),
      next,
    );
  }

  /** 하나 읽기 (AI 도구의 get_wiki) */
  async note(actor: Actor, req: WikiIdInput): Promise<ToolWikiView> {
    WikiQuery.assertCanRead(actor);
    return new ToolWikiView(await this.find(actor, req.id));
  }

  /** 볼 수 있는 wiki 한 줄과 지금 판의 본문 */
  private async find(actor: Actor, id: string): Promise<WikiDetailRow> {
    const [row] = await this.sql<WikiDetailRow[]>`
      SELECT w.*, r.body_md, r.sections
      FROM vault.wikis w
      JOIN vault.nodes n ON n.id = w.node_id
      JOIN vault.wiki_revisions r ON r.id = w.head_revision_id
      WHERE w.node_id = ${id} AND ${this.inSpace(actor)} AND n.deleted_at IS NULL
        ${this.visibleTo(actor, 'w.visibility')}`;
    if (!row) throw new NotFound('wiki를 찾을 수 없어요');
    return row;
  }

  /** AI 도구의 읽기는 read_public이나 read_all 중 하나만 있어도 된다 */
  private static assertCanRead(actor: Actor): void {
    if (!actor.canSeePrivate()) actor.assertCan(Actor.READ_PUBLIC);
  }

  /** 찾을 말이 모두 제목이나 본문에 있어야 한다. 말이 없으면 조건도 없다 */
  private matching(words: readonly string[]) {
    return words.reduce(
      (found, word) =>
        this
          .sql`${found} AND (w.title LIKE likequery(${word}) OR w.head_text LIKE likequery(${word}))`,
      this.sql``,
    );
  }

  private inSpace(actor: Actor) {
    return actor.spaceId === null ? this.sql`TRUE` : this.sql`w.space_id = ${actor.spaceId}`;
  }
}
