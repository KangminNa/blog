import { Injectable } from '@nestjs/common';
import { type Actor, BaseQuery, NotFound } from '../../platform';

// 글이 가리킬 wiki를 blog가 묻는 읽기. blog는 vault 테이블을 모르므로 여기서 답한다.
// 볼 수 없는 wiki는 없는 wiki와 똑같다: 있는지조차 드러나지 않게 같은 NotFound다. 휴지통 wiki도 없는 wiki다.
@Injectable()
export class PostWikiQuery extends BaseQuery {
  /** ids 중 이 요청자가 볼 수 있는 wiki */
  async visible(actor: Actor, ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.sql`
      SELECT w.node_id FROM vault.wikis w JOIN vault.nodes n ON n.id = w.node_id
      WHERE w.node_id = ANY(${ids as string[]}::uuid[]) AND n.deleted_at IS NULL
        ${actor.spaceId === null ? this.sql`` : this.sql`AND w.space_id = ${actor.spaceId}`}
        ${this.visibleTo(actor, 'w.visibility')}`;
    return new Set(rows.map((r) => String(r.node_id)));
  }

  /** 모두 볼 수 있어야 한다. 트랜잭션을 열기 전에 부른다 (blog와 한 트랜잭션에 묶지 않는다) */
  async assertVisible(actor: Actor, ids: readonly string[]): Promise<void> {
    const seen = await this.visible(actor, ids);
    if (ids.some((id) => !seen.has(id))) throw new NotFound('찾을 수 없는 위키예요');
  }
}
