import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, OwnerActor, Unauthenticated } from '../../platform';
import { users } from '../account.schema';
import type { SpaceMemberRow } from '../account.tables';
import { WebSession } from './owner';
import { OwnerView } from './owner.view';

// 주인 읽기: 로그인 쿠키 → 요청자(Guard), 로그인한 사람 정보.
@Injectable()
export class OwnerQuery extends BaseQuery {
  /** Guard가 부른다: 끝나지 않은 로그인이면 주인, 아니면 null */
  async actorFor(token: string): Promise<OwnerActor | null> {
    const [row] = await this.sql<SpaceMemberRow[]>`
      SELECT m.* FROM account.web_sessions w
      JOIN account.space_members m ON m.user_id = w.user_id AND m.role = 'owner'
      WHERE w.token_hash = ${WebSession.hash(token)} AND w.revoked_at IS NULL AND w.expires_at > now()`;
    return row ? new OwnerActor(row.space_id, row.user_id) : null;
  }

  async me(actor: Actor): Promise<OwnerView> {
    if (actor.kind !== 'owner' || !actor.id) throw new Unauthenticated('로그인해 주세요');
    const row = await this.row(
      users,
      { id: actor.id },
      { columns: ['login', 'display_name', 'version'] },
    );
    if (!row) throw new Unauthenticated('로그인해 주세요');
    return new OwnerView(row);
  }
}
