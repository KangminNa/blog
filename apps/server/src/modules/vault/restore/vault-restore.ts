import {
  type ArchiveFile,
  ArchivePart,
  ArchiveQuery,
  ArchiveRecord,
  RuleViolation,
  type Sql,
} from '../../platform';
import {
  RestoredCategory,
  RestoredEdge,
  RestoredPin,
  RestoredPostMark,
  RestoredSession,
  RestoredWiki,
} from './restored-items';
import { VaultRestoreRepository } from './vault-restore.repository';

// 복원에서 vault의 몫: 카테고리, wiki, 세션, 선, 고정한 점 위치, 글 자리 사본.
// 이벤트를 남기지 않는다: 정리 요청과 일 요청이 생기지 않고, 일꾼이 할 일도 없다.
// 공개 저장소에서 받은 묶음에는 vault 파일이 없다. 그때는 빈 채로 넘어가고 글 자리만 채운다.
export class VaultRestore extends ArchivePart {
  private static readonly CATEGORIES = 'vault/categories.yml';
  private static readonly GRAPH = 'vault/graph.json';
  private static readonly WIKI = /^vault\/wikis\/[^/]+\.md$/;
  private static readonly SESSION = /^vault\/sessions\/.+\.md$/;
  private static readonly POST = /^blog\/posts\/.+\.md$/;

  private constructor(
    private readonly categories: readonly RestoredCategory[],
    private readonly wikis: readonly RestoredWiki[],
    private readonly sessions: readonly RestoredSession[],
    private readonly edges: readonly RestoredEdge[],
    private readonly pins: readonly RestoredPin[],
    private readonly marks: readonly RestoredPostMark[],
    private readonly findings: readonly string[],
  ) {
    super();
  }

  static read(files: readonly ArchiveFile[]): VaultRestore {
    const categories: RestoredCategory[] = [];
    const wikis: RestoredWiki[] = [];
    const sessions: RestoredSession[] = [];
    const marks: RestoredPostMark[] = [];
    let graph: ArchiveFile | null = null;
    for (const file of files) {
      if (VaultRestore.POST.test(file.path)) {
        marks.push(RestoredPostMark.read(VaultRestore.document(file, 'post', ArchiveQuery.FORMAT)));
      } else if (file.path === VaultRestore.CATEGORIES) {
        const text = VaultRestore.textOf(file);
        for (const record of ArchiveRecord.listOfYaml(file.path, text))
          categories.push(RestoredCategory.read(record));
      } else if (file.path === VaultRestore.GRAPH) {
        graph = file;
      } else if (VaultRestore.WIKI.test(file.path)) {
        wikis.push(RestoredWiki.read(VaultRestore.document(file, 'wiki', ArchiveQuery.FORMAT)));
      } else if (VaultRestore.SESSION.test(file.path)) {
        sessions.push(
          RestoredSession.read(VaultRestore.document(file, 'session', ArchiveQuery.FORMAT)),
        );
      } else if (file.path.startsWith('vault/')) {
        throw new RuleViolation(`모르는 파일이에요: ${file.path}`);
      }
    }
    return VaultRestore.checked(categories, wikis, sessions, graph, marks);
  }

  /** 서로 가리키는 것을 맞춰 본다. 휴지통의 wiki·점을 가리키는 값은 옛 백업에 남아 있을 수 있어 멈추지 않고 뺀다 */
  private static checked(
    categories: readonly RestoredCategory[],
    wikis: readonly RestoredWiki[],
    sessions: readonly RestoredSession[],
    graph: ArchiveFile | null,
    marks: readonly RestoredPostMark[],
  ): VaultRestore {
    const nodes = [...categories, ...wikis, ...sessions].map((n) => n.id);
    VaultRestore.assertUnique(nodes, 'id');
    VaultRestore.assertUnique(
      categories.map((c) => c.row.slug),
      '카테고리 주소',
    );
    VaultRestore.assertUnique(
      wikis.map((w) => w.row.slug),
      'wiki 주소',
    );
    const categoryIds = new Set(categories.map((c) => c.id));
    const missing = wikis.find(
      ({ row }) => row.category_id !== null && !categoryIds.has(row.category_id),
    );
    if (missing)
      throw new RuleViolation(
        `vault/wikis/${missing.row.slug}.md: 없는 카테고리를 가리켜요: ${missing.row.category_id}`,
      );

    const [allEdges, pins] = VaultRestore.readGraph(graph);
    VaultRestore.assertUnique(
      allEdges.map((e) => e.id),
      '선 id',
    );
    const known = new Set(nodes);
    const edges = allEdges.filter((e) => known.has(e.row.src) && known.has(e.row.dst));
    const wikiIds = new Set(wikis.map((w) => w.id));
    const orphans = sessions.filter((s) => s.wikiId !== null && !wikiIds.has(s.wikiId));
    const findings = [
      ...(nodes.length === 0 ? ['vault 파일이 없어요: 글과 사진만 들어와요'] : []),
      ...(allEdges.length > edges.length
        ? [`끝점이 없는 선 ${allEdges.length - edges.length}개는 빼요`]
        : []),
      ...(orphans.length > 0
        ? [`대표 wiki가 없는 세션 ${orphans.length}개는 도착 구역으로 가요`]
        : []),
    ];
    return new VaultRestore(categories, wikis, sessions, edges, pins, marks, findings);
  }

  private static readGraph(
    file: ArchiveFile | null,
  ): readonly [readonly RestoredEdge[], readonly RestoredPin[]] {
    if (!file) return [[], []];
    let parsed: { edges?: unknown; pinned_nodes?: unknown };
    try {
      parsed = JSON.parse(VaultRestore.textOf(file));
    } catch (error) {
      if (error instanceof RuleViolation) throw error;
      throw new RuleViolation(`${file.path}: JSON으로 읽을 수 없어요`);
    }
    if (!Array.isArray(parsed.edges) || !Array.isArray(parsed.pinned_nodes))
      throw new RuleViolation(`${file.path}: edges와 pinned_nodes가 없어요`);
    return [
      parsed.edges.map((e) => RestoredEdge.read(ArchiveRecord.ofJson(file.path, e))),
      parsed.pinned_nodes.map((p) => RestoredPin.read(ArchiveRecord.ofJson(file.path, p))),
    ];
  }

  get counts(): ReadonlyMap<string, number> {
    return VaultRestore.present([
      ['카테고리', this.categories.length],
      ['wiki', this.wikis.length],
      ['세션', this.sessions.length],
      ['선', this.edges.length],
    ]);
  }

  override get notes(): readonly string[] {
    return this.findings;
  }

  async existing(tx: Sql): Promise<ReadonlyMap<string, number>> {
    const found = await new VaultRestoreRepository(tx).existing();
    return VaultRestore.present([
      ['카테고리', found.get('category') ?? 0],
      ['wiki', found.get('wiki') ?? 0],
      ['세션', found.get('session') ?? 0],
    ]);
  }

  async write(tx: Sql, spaceId: string): Promise<readonly string[]> {
    const repository = new VaultRestoreRepository(tx);
    const wikiIds = new Set(this.wikis.map((w) => w.id));
    for (const category of this.categories) await repository.saveCategory(spaceId, category);
    for (const wiki of this.wikis) await repository.saveWiki(spaceId, wiki);
    for (const session of this.sessions) {
      const live = session.wikiId !== null && wikiIds.has(session.wikiId);
      await repository.saveSession(spaceId, session, live ? session.wikiId : null);
    }
    for (const edge of this.edges) await repository.saveEdge(spaceId, edge);
    for (const mark of this.marks) {
      const main = mark.row.main_wiki_id;
      const live = main !== null && wikiIds.has(main);
      await repository.savePostMark(spaceId, mark, live ? main : null);
    }
    const placed = await repository.savePins(spaceId, this.pins);
    return placed < this.pins.length
      ? [`그래프 보기가 없어 고정한 점 위치 ${this.pins.length - placed}개는 넣지 않았어요`]
      : [];
  }
}
