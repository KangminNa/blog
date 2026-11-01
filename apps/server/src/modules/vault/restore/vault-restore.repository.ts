import type { Sql } from '../../platform';
import { SessionNote } from '../session/session-note';
import {
  type RestoredCategory,
  type RestoredEdge,
  type RestoredPin,
  type RestoredPostMark,
  RestoredSession,
  type RestoredWiki,
} from './restored-items';

// 복원의 vault 쓰기. 여러 데이터 묶음을 새 행으로만 넣는다 (복원은 빈 곳에만 하므로 불러오지 않는다).
// 판 행의 칸은 SessionRepository · WikiRepository가 쓰는 것과 같다. outbox에는 남기지 않는다.
export class VaultRestoreRepository {
  private static readonly SYSTEM = 'system';

  constructor(private readonly tx: Sql) {}

  /** 종류별로 있는 점의 수. 휴지통 것도 센다 (id와 주소를 차지한다). 끝날 때까지 새 점이 끼어들지 못하게 잠근다 */
  async existing(): Promise<ReadonlyMap<string, number>> {
    await this.tx`LOCK TABLE vault.nodes IN SHARE ROW EXCLUSIVE MODE`;
    const rows = await this.tx`SELECT kind, count(*)::int AS n FROM vault.nodes GROUP BY kind`;
    return new Map(rows.map((r) => [String(r.kind), Number(r.n)]));
  }

  async saveCategory(spaceId: string, c: RestoredCategory): Promise<void> {
    await this.saveNode(spaceId, c.id, 'category', c.createdAt);
    await this.tx`
      INSERT INTO vault.categories (node_id, space_id, name, slug, color, description, sort, origin, pinned)
      VALUES (${c.id}, ${spaceId}, ${c.name}, ${c.slug}, ${c.color}, ${c.description}, ${c.sort},
        ${c.origin}, ${c.pinned})`;
  }

  async saveWiki(spaceId: string, w: RestoredWiki): Promise<void> {
    await this.saveNode(spaceId, w.id, 'wiki', w.createdAt);
    await this.tx`
      INSERT INTO vault.wikis (node_id, space_id, category_id, title, slug, visibility, origin,
        head_revision_id, pinned_sections, head_text, revision_count, created_at, updated_at, meta)
      VALUES (${w.id}, ${spaceId}, ${w.categoryId}, ${w.title}, ${w.slug}, ${w.visibility}, ${w.origin},
        ${w.revisionId}, ${w.pinned as string[]}, ${w.body.markdown}, 1, ${w.createdAt}, ${w.createdAt},
        ${this.tx.json(w.meta as never)})`;
    await this.tx`
      INSERT INTO vault.wiki_revisions (id, wiki_id, seq, kind, body_md, sections, section_hashes,
        content_hash, actor_type, created_at)
      VALUES (${w.revisionId}, ${w.id}, 1, ${w.origin}, ${w.body.markdown},
        ${this.tx.json(w.body.sections.map((s) => s.toJSON()) as never)},
        ${this.tx.json(w.body.sectionHashes())}, ${w.body.hash}, ${VaultRestoreRepository.SYSTEM},
        ${w.createdAt})`;
  }

  /** wikiId: 대표 wiki 중 복원되는 것. 파일의 값과 다를 수 있다 */
  async saveSession(spaceId: string, s: RestoredSession, wikiId: string | null): Promise<void> {
    const at = s.started ?? new Date();
    await this.saveNode(spaceId, s.id, 'session', at);
    await this.tx`
      INSERT INTO vault.sessions (node_id, space_id, device_id, tool, source_session_id, project,
        visibility, head_revision_id, head_title, head_text, revision_count, started_at, last_revision_at,
        wiki_id, pinned_sections, meta)
      VALUES (${s.id}, ${spaceId}, ${RestoredSession.NO_DEVICE}, ${s.tool}, ${s.id}, ${s.project}, ${s.visibility},
        ${s.revisionId}, ${s.note.title}, ${s.body}, 1, ${s.started}, ${at}, ${wikiId},
        ${s.pinned as string[]}, ${this.tx.json(s.meta as never)})`;
    await this.tx`
      INSERT INTO vault.session_revisions (id, session_id, seq, kind, body_md, sections, sections_schema,
        section_hashes, content_hash, actor_type, created_at)
      VALUES (${s.revisionId}, ${s.id}, 1, 'origin', ${s.body}, ${this.tx.json(s.note.toJSON() as never)},
        ${SessionNote.SCHEMA}, ${this.tx.json(s.note.sectionHashes())}, ${s.note.hash},
        ${VaultRestoreRepository.SYSTEM}, ${at})`;
  }

  async saveEdge(spaceId: string, e: RestoredEdge): Promise<void> {
    await this.tx`
      INSERT INTO vault.edges (id, space_id, src, dst, kind, weight, origin, pinned, actor_type, created_at,
        deleted_at, deleted_by_type)
      VALUES (${e.id}, ${spaceId}, ${e.src}, ${e.dst}, ${e.kind}, ${e.weight}, ${e.origin}, ${e.pinned},
        ${VaultRestoreRepository.SYSTEM}, ${e.createdAt}, ${e.deletedAt}, ${e.deletedBy})`;
  }

  /** mainWikiId: 복원되는 wiki일 때만. 외래키가 있어 없는 wiki를 가리킬 수 없다 */
  async savePostMark(
    spaceId: string,
    m: RestoredPostMark,
    mainWikiId: string | null,
  ): Promise<void> {
    await this.tx`
      INSERT INTO vault.post_marks (post_id, space_id, title, slug, status, main_wiki_id, ref_wiki_ids, post_version)
      VALUES (${m.id}, ${spaceId}, ${m.title}, ${m.slug}, ${m.status}, ${mainWikiId},
        ${m.refWikiIds as string[]}::uuid[], 1)`;
  }

  /** 이름이 같은 그래프 보기가 있는 위치만 넣는다. 넣은 수를 돌려준다. 보기는 보관 파일에 없다 */
  async savePins(spaceId: string, pins: readonly RestoredPin[]): Promise<number> {
    if (pins.length === 0) return 0;
    const views = await this.tx`SELECT id, name FROM vault.graph_views WHERE space_id = ${spaceId}`;
    const byName = new Map(views.map((v) => [String(v.name), String(v.id)]));
    let placed = 0;
    for (const pin of pins) {
      const view = byName.get(pin.view);
      if (!view) continue;
      await this.tx`
        INSERT INTO vault.node_layout (view_id, node_id, x, y, pinned)
        VALUES (${view}, ${pin.node}, ${pin.x}, ${pin.y}, true)`;
      placed += 1;
    }
    return placed;
  }

  private async saveNode(spaceId: string, id: string, kind: string, at: Date): Promise<void> {
    await this.tx`
      INSERT INTO vault.nodes (id, space_id, kind, created_at) VALUES (${id}, ${spaceId}, ${kind}, ${at})`;
  }
}
