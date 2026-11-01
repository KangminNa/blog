import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery, type Row } from '../../platform';
import { TidyBacklogPageView, TidySessionView, TidySettingsView } from './tidy.view';

// 세션 정리 읽기: 설정(주인), 정리를 맡길 세션. 자동 정리는 일꾼이 SystemActor로 읽는다.
@Injectable()
export class TidyQuery extends BaseQuery {
  /** 한 번에 맡기는 세션 수. 주인의 구독 토큰을 쓰므로 조금씩 */
  private static readonly BACKLOG_BATCH = 20;

  async settings(actor: Actor): Promise<TidySettingsView> {
    actor.assertOwner();
    const [row] = await this.sql`
      SELECT auto_tidy, version FROM vault.tidy_settings WHERE space_id = ${actor.spaceId}`;
    return row
      ? new TidySettingsView(Boolean(row.auto_tidy), Number(row.version))
      : new TidySettingsView(false, 0);
  }

  /** 저장된 세션 하나. 그사이 지웠으면 null */
  async session(actor: Actor, spaceId: string, id: string): Promise<TidySessionView | null> {
    actor.assertCan(Actor.TIDY);
    const [row] = await this.sql`
      SELECT s.node_id, s.head_title, s.revision_count, s.version
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${id} AND s.space_id = ${spaceId} AND n.deleted_at IS NULL`;
    return row ? TidyQuery.view(row) : null;
  }

  /** 대표 wiki가 없는 세션. 오래된 순(UUIDv7)으로 한 묶음과 전체 수 */
  async backlog(actor: Actor): Promise<TidyBacklogPageView> {
    actor.assertOwner();
    const rows = await this.sql`
      SELECT s.node_id, s.head_title, s.revision_count, s.version, count(*) OVER () AS total
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.space_id = ${actor.spaceId} AND s.wiki_id IS NULL AND n.deleted_at IS NULL
      ORDER BY s.node_id
      LIMIT ${TidyQuery.BACKLOG_BATCH}`;
    return new TidyBacklogPageView(
      rows.map((r) => TidyQuery.view(r)),
      Number(rows[0]?.total ?? 0),
    );
  }

  private static view(r: Row): TidySessionView {
    return new TidySessionView(
      String(r.node_id),
      String(r.head_title ?? ''),
      Number(r.revision_count),
      Number(r.version),
    );
  }
}
