import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery } from '../../platform';
import { ListChangesInput } from './change.input';
import { WaitingChangePageView, type WaitingChangeRow, WaitingChangeView } from './change.view';

// 변경 묶음 읽기. 승인함(검토를 기다리는 변경)은 주인만 본다.
@Injectable()
export class ChangeQuery extends BaseQuery {
  private static readonly PAGE = 30;

  /** 오래된 묶음부터. 순서는 묶음 id(UUIDv7)와 변경 번호라 쪽을 넘기는 사이에 결정해도 빠지거나 겹치지 않는다 */
  async waiting(actor: Actor, req: ListChangesInput): Promise<WaitingChangePageView> {
    actor.assertOwner();
    const rows = await this.sql<WaitingChangeRow[]>`
      SELECT o.*, s.version AS set_version, s.kind, s.message, s.actor_type, s.actor_id, s.created_at
      FROM vault.change_sets s JOIN vault.change_ops o ON o.change_set_id = s.id
      WHERE s.space_id = ${actor.spaceId} AND s.status = 'review' AND o.status = 'waiting'
        ${req.after === null ? this.sql`` : this.sql`AND (o.change_set_id, o.seq) > (${req.after[0]}::uuid, ${req.after[1]}::int)`}
      ORDER BY o.change_set_id, o.seq
      LIMIT ${ChangeQuery.PAGE + 1}`;
    const page = rows.slice(0, ChangeQuery.PAGE);
    const last = page.at(-1);
    return new WaitingChangePageView(
      page.map((r) => new WaitingChangeView(r)),
      rows.length > ChangeQuery.PAGE && last
        ? ListChangesInput.cursorAfter(last.change_set_id, last.seq)
        : null,
    );
  }
}
