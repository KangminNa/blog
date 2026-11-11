import { BaseRepository, Notices } from '../../platform';
import { staleWikis } from '../vault.schema';
import { type LoadedStaleWikis, StaleWikis } from './stale-wikis';

// vault.stale_wikis ↔ StaleWikis(공간 하나의 알린 기록). 공간을 advisory 잠금으로 잠가 일꾼이 겹쳐 돌아도 한 번만 알린다.
// 알림은 같은 트랜잭션에서 platform의 Notices로 남긴다 (기록과 알림이 함께 커밋된다).
export class StaleWikiRepository extends BaseRepository<StaleWikis> {
  protected toEntity(row: LoadedStaleWikis): StaleWikis {
    return StaleWikis.restore(row);
  }

  async lock(spaceId: string): Promise<StaleWikis> {
    await this.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vault.stale:${spaceId}`}, 0))`;
    const [row] = await this.sql<LoadedStaleWikis[]>`
      SELECT ${spaceId}::uuid AS id, coalesce(array_agg(wiki_id), '{}') AS wiki_ids
      FROM vault.stale_wikis WHERE space_id = ${spaceId}`;
    return this.toEntity(row ?? { id: spaceId, wiki_ids: [] });
  }

  async save(stale: StaleWikis): Promise<void> {
    if (stale.goneIds.length > 0)
      await this.deleteRows(staleWikis, { space_id: stale.spaceId, wiki_id: stale.goneIds });
    const rows = stale.newRows;
    if (rows.length > 0) await this.insertRows(staleWikis, rows);
    const notice = stale.notice();
    if (notice) await new Notices(this.sql).post(notice);
  }
}
