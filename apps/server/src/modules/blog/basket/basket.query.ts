import { Injectable } from '@nestjs/common';
import { Actor, BaseQuery } from '../../platform';
import type { BasketItemRow } from '../blog.tables';
import { BasketItemView, BasketView, ToolBasketView } from './basket.view';

// 소재 읽기. 소재에는 비공개 자료가 담기므로 REST는 주인만, MCP는 write 권한으로만 본다.
// 기기 토큰이 REST로 와도 주인의 화면을 보지 못하게 두 입구의 확인을 나눈다.
@Injectable()
export class BasketQuery extends BaseQuery {
  /** 넘긴 해시 중 소재가 가리키는 것 (platform의 BlobStore.sweep이 묻는다) */
  async usedBlobs(actor: Actor, hashes: readonly string[]): Promise<readonly string[]> {
    actor.assertOwnerOrSystem();
    const rows = await this.sql`
      SELECT DISTINCT blob_hash AS hash FROM work.basket_items
       WHERE blob_hash = ANY(${hashes as string[]}::text[])`;
    return rows.map((row) => String(row.hash));
  }

  /** 콘솔의 소재 메뉴. 아직 상자가 없으면 빈 목록이다 (읽기는 상자를 만들지 않는다) */
  async list(actor: Actor): Promise<BasketView> {
    actor.assertOwner();
    return new BasketView((await this.items(actor)).map((r) => new BasketItemView(r)));
  }

  /** AI 도구의 basket_get */
  async forWriting(actor: Actor): Promise<ToolBasketView> {
    actor.assertCan(Actor.WRITE);
    return new ToolBasketView(await this.items(actor));
  }

  private items(actor: Actor): Promise<readonly BasketItemRow[]> {
    return this.sql<BasketItemRow[]>`
      SELECT i.* FROM work.basket_items i JOIN work.baskets b ON b.id = i.basket_id
      WHERE b.space_id = ${actor.spaceId} AND b.archived_at IS NULL
      ORDER BY i.sort, i.id DESC`;
  }
}
