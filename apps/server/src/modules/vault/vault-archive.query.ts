import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Actor, ArchiveFile, ArchiveQuery, BaseQuery, Database } from '../platform';
import { SlugPolicy } from './slug.policy';

// vault의 보관 파일 (docs/보관형식.md): 카테고리, wiki, 세션, 선. 현재 판만 파일이 되고 지난 판은 git 이력으로 본다.
// 검색 조각·임베딩·스냅샷은 다시 계산되는 값이라 뺀다. 첨부(assets/)는 파일 저장소가 생긴 뒤에 더한다.
// 세션의 `device`(기기 이름)는 account 모듈의 것이라 넣지 않는다 (앞부분의 "있으면" 칸).
@Injectable()
export class VaultArchiveQuery extends BaseQuery implements OnModuleInit {
  /** 프로젝트가 없는 세션의 폴더 */
  private static readonly NO_PROJECT = 'no-project';

  constructor(
    db: Database,
    private readonly archive: ArchiveQuery,
  ) {
    super(db);
  }

  onModuleInit(): void {
    this.archive.register('vault', (actor) => this.files(actor));
  }

  async files(actor: Actor): Promise<readonly ArchiveFile[]> {
    return [
      await this.categories(actor),
      ...(await this.wikis(actor)),
      ...(await this.sessions(actor)),
      await this.graph(actor),
    ];
  }

  private async categories(actor: Actor): Promise<ArchiveFile> {
    const rows = await this.sql`
      SELECT c.node_id, c.name, c.slug, c.color, c.sort, c.description
      FROM vault.categories c JOIN vault.nodes n ON n.id = c.node_id
      WHERE ${this.inSpace(actor, 'c')} AND n.deleted_at IS NULL
      ORDER BY c.sort, c.node_id`;
    return ArchiveFile.yamlList(
      'vault/categories.yml',
      rows.map((r) => ({
        cairn_id: r.node_id,
        name: r.name,
        slug: r.slug,
        color: r.color,
        sort: r.sort,
        description: r.description,
      })),
    );
  }

  private async wikis(actor: Actor): Promise<ArchiveFile[]> {
    const rows = await this.sql`
      SELECT w.node_id, w.title, w.slug, w.visibility, w.category_id, r.body_md
      FROM vault.wikis w
      JOIN vault.nodes n ON n.id = w.node_id
      JOIN vault.wiki_revisions r ON r.id = w.head_revision_id
      WHERE ${this.inSpace(actor, 'w')} AND n.deleted_at IS NULL
      ORDER BY w.node_id`;
    return rows.map((r) =>
      ArchiveFile.markdown(
        `vault/wikis/${r.slug}.md`,
        {
          cairn_format: ArchiveQuery.FORMAT,
          cairn_type: 'wiki',
          cairn_id: r.node_id,
          title: r.title,
          visibility: r.visibility,
          ...(r.category_id === null ? {} : { cairn_category: r.category_id }),
        },
        String(r.body_md),
      ),
    );
  }

  private async sessions(actor: Actor): Promise<ArchiveFile[]> {
    const rows = await this.sql`
      SELECT s.node_id, s.head_title, s.visibility, s.tool, s.project, s.wiki_id, s.started_at,
             s.last_revision_at, r.body_md, r.sections
      FROM vault.sessions s
      JOIN vault.nodes n ON n.id = s.node_id
      JOIN vault.session_revisions r ON r.id = s.head_revision_id
      WHERE ${this.inSpace(actor, 's')} AND n.deleted_at IS NULL
      ORDER BY s.node_id`;
    const used = new Set<string>();
    return rows.map((r) => {
      const started = (r.started_at ?? r.last_revision_at) as Date | null;
      const day = started ? new Date(started).toISOString().slice(0, 10) : 'undated';
      const folder = SlugPolicy.fromTitle(String(r.project ?? '')) || VaultArchiveQuery.NO_PROJECT;
      const wanted = `${folder}/${day}-${SlugPolicy.fromTitle(String(r.head_title ?? '')) || 'session'}`;
      const name = used.has(wanted) ? SlugPolicy.numbered(wanted, used) : wanted;
      used.add(name);
      const tags = ((r.sections as Record<string, unknown> | null)?.tags ?? []) as string[];
      return ArchiveFile.markdown(
        `vault/sessions/${name}.md`,
        {
          cairn_format: ArchiveQuery.FORMAT,
          cairn_type: 'session',
          cairn_id: r.node_id,
          title: r.head_title,
          visibility: r.visibility,
          tool: r.tool,
          started: started ? new Date(started) : null,
          ...(r.wiki_id === null ? {} : { cairn_wiki: r.wiki_id }),
          ...(r.project === null ? {} : { project: r.project }),
          ...(tags.length === 0 ? {} : { tags }),
        },
        String(r.body_md),
      );
    });
  }

  /** 선과 그 출처·고정·사람이 지운 흔적, 고정한 점 위치. 지운 선의 행도 넣는다: 복원 뒤에도 AI가 다시 못 만들게 */
  private async graph(actor: Actor): Promise<ArchiveFile> {
    const edges = await this.sql`
      SELECT e.id, e.src, e.dst, e.kind, e.weight, e.origin, e.pinned, e.deleted_at, e.deleted_by_type
      FROM vault.edges e
      WHERE ${this.inSpace(actor, 'e')}
      ORDER BY e.id`;
    const layout = await this.sql`
      SELECT v.name AS view, l.node_id, l.x, l.y
      FROM vault.node_layout l JOIN vault.graph_views v ON v.id = l.view_id
      WHERE l.pinned AND ${this.inSpace(actor, 'v')}
      ORDER BY v.name, l.node_id`;
    const graph = {
      edges: edges.map((e) => ({
        cairn_id: e.id,
        src: e.src,
        dst: e.dst,
        kind: e.kind,
        weight: e.weight,
        origin: e.origin,
        pinned: e.pinned,
        deleted_at: e.deleted_at,
        deleted_by: e.deleted_by_type,
      })),
      pinned_nodes: layout.map((l) => ({ view: l.view, node: l.node_id, x: l.x, y: l.y })),
    };
    return ArchiveFile.text('vault/graph.json', `${JSON.stringify(graph, null, 2)}\n`);
  }

  /** 동기화 플러그인(SystemActor)은 공간이 없다. MVP는 공간 하나 */
  private inSpace(actor: Actor, table: string) {
    return actor.spaceId === null
      ? this.sql`TRUE`
      : this.sql`${this.sql(`${table}.space_id`)} = ${actor.spaceId}`;
  }
}
