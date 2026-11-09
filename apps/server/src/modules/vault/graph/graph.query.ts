import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, NotFound, Rule } from '../../platform';
import { edges, postMarks } from '../vault.schema';
import type { CategoryRow, PostMarkRow, SessionRow, WikiRow } from '../vault.tables';
import type { NeighborsInput } from './graph.input';
import { GraphEdgeView, GraphNodeView, GraphView, NeighborsView, NeighborView } from './graph.view';

/** 그래프에 그리는 글 한 줄 (글 자리 사본) */
type GraphPostRow = Pick<
  PostMarkRow,
  'post_id' | 'title' | 'slug' | 'status' | 'main_wiki_id' | 'ref_wiki_ids'
>;

// 그래프 읽기. 점과 선은 보여도 되는 것만 SQL에서 고른 뒤에 잇는다 (기획서 9장, 원칙 4·5).
//   주인      전부
//   방문자    카테고리 이름, 공개 wiki·세션, 공개(published) 글
// 글 → wiki 연결은 모두에게 보이므로, 공개 글이 가리키는 비공개 wiki만 자리로 남는다. 이름·내용·날짜는 없다.
// id를 그대로 주면 UUIDv7이라 날짜가 드러나서 자리의 id는 해시로 바꾼다. 그 밖의 비공개는 흔적 없이 빠진다.
// 점과 선의 View는 표 한 줄이 아니라 여러 표를 이은 모양이라 여기서 칸을 골라 만든다.
@Injectable()
export class GraphQuery extends BaseQuery {
  private static readonly CATEGORY = 'category';
  private static readonly WIKI = 'wiki';
  private static readonly SESSION = 'session';
  private static readonly POST = 'post';
  private static readonly REF = 'ref';
  private static readonly PARENT = 'parent';
  private static readonly CHILD = 'child';
  private static readonly PUBLIC = 'public';
  private static readonly PRIVATE = 'private';
  private static readonly PUBLISHED = 'published';
  /** 비공개 wiki 자리의 id 앞머리 */
  private static readonly HIDDEN = 'private-';
  private static readonly HIDDEN_LENGTH = 16;

  /** 주인의 그래프 */
  async owner(actor: Actor): Promise<GraphView> {
    actor.assertOwner();
    return this.build(actor, true);
  }

  /** 방문자의 그래프. 주인이 불러도 방문자가 보는 그대로다 */
  async visitors(actor: Actor): Promise<GraphView> {
    return this.build(actor, false);
  }

  /** 점 하나와 이웃 (AI 도구). 볼 수 없는 점은 없는 점과 똑같이 NotFound, 비공개 자리는 이웃으로 알리지 않는다 */
  async neighbors(actor: Actor, req: NeighborsInput): Promise<NeighborsView> {
    const full = actor.canSeePrivate();
    if (!full) actor.assertCan(Actor.READ_PUBLIC);
    const graph = await this.build(actor, full);
    const node = graph.nodes.find((n) => n.id === req.nodeId);
    if (!node) throw new NotFound('점을 찾을 수 없어요');
    return new NeighborsView(node, GraphQuery.around(graph, node));
  }

  private async build(actor: Actor, full: boolean): Promise<GraphView> {
    const [categories, wikis, sessions, posts] = await Promise.all([
      this.categories(actor),
      this.wikis(actor, full),
      this.sessions(actor, full),
      this.posts(actor, full),
    ]);
    const categoryIds = new Set(categories.map((c) => c.node_id));
    const wikiIds = new Set(wikis.map((w) => w.node_id));
    const places = await this.hiddenWikis(posts, wikiIds, full);
    const nodes: GraphNodeView[] = [
      ...categories.map((c) => GraphQuery.categoryNode(c)),
      ...wikis.map((w) => GraphQuery.wikiNode(w, categoryIds)),
      ...sessions.map((s) => GraphQuery.sessionNode(s, wikiIds)),
      ...[...places.values()].sort().map(GraphQuery.placeNode),
    ];
    const edges = await this.lines([...wikiIds, ...sessions.map((s) => s.node_id)]);
    const address = (id: string) => (wikiIds.has(id) ? id : (places.get(id) ?? null));
    for (const p of posts) {
      const main = String(p.main_wiki_id);
      const parent = address(main);
      if (parent === null) continue; // 대표 wiki가 휴지통에 있으면 대표가 없는 글과 같다
      nodes.push(GraphQuery.postNode(p, parent));
      for (const ref of p.ref_wiki_ids ?? []) {
        const dst = ref === main ? null : address(ref);
        if (dst !== null) edges.push(new GraphEdgeView(p.post_id, dst, GraphQuery.REF));
      }
    }
    return new GraphView(nodes, edges);
  }

  private categories(actor: Actor) {
    return this.sql<Pick<CategoryRow, 'node_id' | 'name'>[]>`
      SELECT c.node_id, c.name FROM vault.categories c JOIN vault.nodes n ON n.id = c.node_id
      WHERE ${this.inSpace(actor, 'c.space_id')} AND n.deleted_at IS NULL
      ORDER BY c.sort, c.name, c.node_id`;
  }

  private wikis(actor: Actor, full: boolean) {
    return this.sql<Pick<WikiRow, 'node_id' | 'title' | 'category_id' | 'visibility'>[]>`
      SELECT w.node_id, w.title, w.category_id, w.visibility
      FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE ${this.inSpace(actor, 'w.space_id')} AND n.deleted_at IS NULL
        ${full ? this.sql`` : this.sql`AND w.visibility = ${GraphQuery.PUBLIC}`}
      ORDER BY w.node_id`;
  }

  private sessions(actor: Actor, full: boolean) {
    return this.sql<Pick<SessionRow, 'node_id' | 'head_title' | 'wiki_id' | 'visibility'>[]>`
      SELECT s.node_id, s.head_title, s.wiki_id, s.visibility
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE ${this.inSpace(actor, 's.space_id')} AND n.deleted_at IS NULL
        ${full ? this.sql`` : this.sql`AND s.visibility = ${GraphQuery.PUBLIC}`}
      ORDER BY s.node_id`;
  }

  /**
   * 대표 wiki가 있는 글 자리 사본, 글 id 순서. 대표 wiki가 없는 글은 그래프에 나오지 않는다.
   * 방문자에게는 공개한 글만 (링크만 공개는 목록에 나오지 않는다). 공간이 없는 요청자는 공간으로 거르지 않는다
   */
  private posts(actor: Actor, full: boolean) {
    return this.rows(
      postMarks,
      {
        space_id: Rule.maybe(actor.spaceId),
        main_wiki_id: Rule.set,
        status: Rule.maybe(full ? null : GraphQuery.PUBLISHED),
      },
      {
        columns: ['post_id', 'title', 'slug', 'status', 'main_wiki_id', 'ref_wiki_ids'],
        order: ['post_id'],
      },
    );
  }

  /** 글이 가리키는 비공개 wiki (진짜 id → 자리 id). 주인에게는 다 보이므로 없다 */
  private async hiddenWikis(
    posts: readonly GraphPostRow[],
    visible: ReadonlySet<string>,
    full: boolean,
  ): Promise<ReadonlyMap<string, string>> {
    if (full) return new Map();
    const refs = posts.flatMap((p) => [String(p.main_wiki_id), ...(p.ref_wiki_ids ?? [])]);
    const unseen = [...new Set(refs)].filter((id) => !visible.has(id));
    if (unseen.length === 0) return new Map();
    const rows = await this.sql<Pick<WikiRow, 'node_id'>[]>`
      SELECT w.node_id FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE w.node_id = ANY(${unseen}::uuid[]) AND n.deleted_at IS NULL`;
    return new Map(rows.map((r) => [r.node_id, GraphQuery.placeOf(r.node_id)]));
  }

  /** 지우지 않은 재료·링크 선 중 양 끝이 모두 보이는 것, id 순서 */
  private async lines(ids: readonly string[]): Promise<GraphEdgeView[]> {
    if (ids.length === 0) return [];
    const rows = await this.rows(
      edges,
      { deleted_at: null, kind: ['material', 'link'], src: ids, dst: ids },
      { columns: ['src', 'dst', 'kind'], order: ['id'] },
    );
    return rows.map((r) => new GraphEdgeView(r.src, r.dst, r.kind));
  }

  private inSpace(actor: Actor, column: string) {
    return actor.spaceId === null
      ? this.sql`TRUE`
      : this.sql`${this.sql(column)} = ${actor.spaceId}`;
  }

  private static categoryNode(r: Pick<CategoryRow, 'node_id' | 'name'>): GraphNodeView {
    return new GraphNodeView(r.node_id, GraphQuery.CATEGORY, r.name, null, null, null);
  }

  private static wikiNode(
    r: Pick<WikiRow, 'node_id' | 'title' | 'category_id' | 'visibility'>,
    categoryIds: ReadonlySet<string>,
  ): GraphNodeView {
    const parent = GraphQuery.within(categoryIds, r.category_id);
    return new GraphNodeView(r.node_id, GraphQuery.WIKI, r.title, parent, r.visibility, null);
  }

  private static sessionNode(
    r: Pick<SessionRow, 'node_id' | 'head_title' | 'wiki_id' | 'visibility'>,
    wikiIds: ReadonlySet<string>,
  ): GraphNodeView {
    const parent = GraphQuery.within(wikiIds, r.wiki_id);
    return new GraphNodeView(
      r.node_id,
      GraphQuery.SESSION,
      r.head_title ?? '',
      parent,
      r.visibility,
      null,
    );
  }

  /** 비공개 wiki의 자리: 이름, 주소, 날짜 없이 공개 글의 연결만 남긴다 */
  private static placeNode(this: void, id: string): GraphNodeView {
    return new GraphNodeView(id, GraphQuery.WIKI, '', null, GraphQuery.PRIVATE, null);
  }

  private static postNode(r: GraphPostRow, parent: string): GraphNodeView {
    const visibility = r.status === GraphQuery.PUBLISHED ? GraphQuery.PUBLIC : GraphQuery.PRIVATE;
    return new GraphNodeView(r.post_id, GraphQuery.POST, r.title, parent, visibility, r.slug);
  }

  /** 주소가 보이는 점이면 그대로, 아니면 빈 주소 (주소로 비공개 점의 id가 새지 않게) */
  private static within(ids: ReadonlySet<string>, id: string | null): string | null {
    return id !== null && ids.has(id) ? id : null;
  }

  private static placeOf(id: string): string {
    const hash = createHash('sha256').update(id).digest('hex');
    return `${GraphQuery.HIDDEN}${hash.slice(0, GraphQuery.HIDDEN_LENGTH)}`;
  }

  private static around(graph: GraphView, node: GraphNodeView): readonly NeighborView[] {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const near = (id: string, relation: string): NeighborView[] => {
      const n = byId.get(id);
      return n && !n.id.startsWith(GraphQuery.HIDDEN)
        ? [new NeighborView(n.id, n.kind, n.label, relation)]
        : [];
    };
    return [
      ...(node.parent === null ? [] : near(node.parent, GraphQuery.PARENT)),
      ...graph.nodes
        .filter((n) => n.parent === node.id)
        .flatMap((n) => near(n.id, GraphQuery.CHILD)),
      ...graph.edges.flatMap((e) => {
        if (e.src === node.id) return near(e.dst, e.kind);
        return e.dst === node.id ? near(e.src, e.kind) : [];
      }),
    ];
  }
}
