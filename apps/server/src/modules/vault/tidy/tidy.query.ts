import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery } from '../../platform';
import type { TidySettingRow } from '../vault.tables';
import { type TidySessionRow, TidySessionView, TidySettingsView } from './tidy.view';

// 세션 정리 읽기: 설정(주인), 정리를 맡길 세션. 자동 정리는 일꾼이 SystemActor로 읽는다.
@Injectable()
export class TidyQuery extends BaseQuery {
  /** 한 번에 맡기는 세션 수. 주인의 구독 토큰을 쓰므로 조금씩 */
  private static readonly BACKLOG_BATCH = 20;

  async settings(actor: Actor): Promise<TidySettingsView> {
    actor.assertOwner();
    const [row] = await this.sql<Pick<TidySettingRow, 'auto_tidy' | 'version'>[]>`
      SELECT auto_tidy, version FROM vault.tidy_settings WHERE space_id = ${actor.spaceId}`;
    return new TidySettingsView(row ?? { auto_tidy: false, version: 0 });
  }

  /** 저장된 세션 하나. 그사이 지웠으면 null */
  async session(actor: Actor, spaceId: string, id: string): Promise<TidySessionView | null> {
    actor.assertCan(Actor.TIDY);
    const [row] = await this.sql<TidySessionRow[]>`
      SELECT s.node_id, s.head_title, s.revision_count, s.version
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE s.node_id = ${id} AND s.space_id = ${spaceId} AND n.deleted_at IS NULL`;
    return row ? new TidySessionView(row) : null;
  }

  /** 이번에 맡길 세션. 오래된 순(UUIDv7)으로 한 묶음 */
  async backlog(actor: Actor): Promise<readonly TidySessionView[]> {
    actor.assertOwner();
    const rows = await this.sql<TidySessionRow[]>`
      SELECT s.node_id, s.head_title, s.revision_count, s.version
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE ${this.waiting(actor)}
      ORDER BY s.node_id
      LIMIT ${TidyQuery.BACKLOG_BATCH}`;
    return rows.map((r) => new TidySessionView(r));
  }

  /** 아직 맡기지 않은 세션 수 */
  async remaining(actor: Actor): Promise<number> {
    actor.assertOwner();
    const [row] = await this.sql<{ total: number }[]>`
      SELECT count(*) AS total
      FROM vault.sessions s JOIN vault.nodes n ON n.id = s.node_id
      WHERE ${this.waiting(actor)}`;
    return row?.total ?? 0;
  }

  /** 대표 wiki가 없고, 지금 판의 정리를 아직 요청하지 않은 세션. 요청한 뒤에 실패한 세션은 새 판이 쌓여야 돌아온다 */
  private waiting(actor: Actor) {
    return this.sql`s.space_id = ${actor.spaceId} AND s.wiki_id IS NULL AND n.deleted_at IS NULL
      AND s.tidy_requested_seq < s.revision_count`;
  }
}
