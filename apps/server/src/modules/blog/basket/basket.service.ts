import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Database, Forbidden, Idempotency } from '../../platform';
import { GetSessionRequest, SessionQuery } from '../../vault';
import { PostQuery } from '../post/post.query';
import { ReadPostRequest } from '../post/post.request';
import { BasketItem } from './basket';
import type { AddBasketItemInput } from './basket.input';
import { BasketRepository } from './basket.repository';

// 소재 담기·지우기. 주인만. 세션·글은 볼 수 있는 것만 담는다.
// vault는 Query로만 읽고, 트랜잭션을 열기 전에 읽는다 (vault와 한 트랜잭션에 묶지 않는다).
@Injectable()
export class BasketService extends BaseService {
  private static readonly ADD = 'add_basket_item';

  constructor(
    db: Database,
    private readonly sessions: SessionQuery,
    private readonly posts: PostQuery,
  ) {
    super(db);
  }

  /** 같은 requestId가 다시 오면 처음 담은 소재를 돌려준다. 첫 소재면 기본 상자를 만든다 */
  async add(actor: Actor, req: AddBasketItemInput): Promise<BasketItem> {
    actor.assertOwner();
    const spaceId = BasketService.spaceOf(actor);
    const title = req.title ?? (await this.titleOf(actor, req));
    return this.transaction(async (tx) => {
      const items = new BasketRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, BasketService.ADD);
      const before = await once.previous();
      if (before) return items.load(spaceId, String(before.itemId));
      const item = BasketItem.open(
        await items.defaultBasket(spaceId),
        req.kind,
        req.refId,
        req.url,
        title,
        req.note,
        actor,
        new Date(),
      );
      await items.save(item);
      await once.remember({ itemId: item.id });
      return item;
    });
  }

  /** 소재만 지운다. 가리키던 세션·글은 그대로다 */
  async remove(actor: Actor, id: string): Promise<void> {
    actor.assertOwner();
    const spaceId = BasketService.spaceOf(actor);
    await this.transaction(async (tx) => {
      const items = new BasketRepository(tx);
      await items.remove(await items.lock(spaceId, id));
    });
  }

  /** 가리키는 세션·글의 제목. 없거나 볼 수 없으면 NotFound. 링크·메모는 가리키는 것이 없다 */
  private async titleOf(actor: Actor, req: AddBasketItemInput): Promise<string | null> {
    if (req.kind === BasketItem.SESSION) {
      const session = GetSessionRequest.from({ session_id: req.refId });
      return (await this.sessions.note(actor, session)).summary.title;
    }
    if (req.kind === BasketItem.POST) {
      const post = ReadPostRequest.from(req.refId ?? '');
      return (await this.posts.editable(actor, post)).summary.title;
    }
    return null;
  }

  private static spaceOf(actor: Actor): string {
    if (!actor.spaceId) throw new Forbidden('owner');
    return actor.spaceId;
  }
}
