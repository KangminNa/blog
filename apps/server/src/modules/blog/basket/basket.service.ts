import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseService,
  Database,
  Idempotency,
  RuleViolation,
  SensitivePolicy,
} from '../../platform';
import { GetSessionInput, SessionQuery } from '../../vault';
import { ReadPostInput } from '../post/post.input';
import { PostQuery } from '../post/post.query';
import { BasketItem } from './basket';
import type { AddBasketItemInput, KeepPageInput } from './basket.input';
import { BasketRepository } from './basket.repository';
import type { KeptPageView } from './basket.view';

// 소재 담기·지우기. 주인만. 세션·글은 볼 수 있는 것만 담는다. 브라우저 확장(upload 기기)은 페이지 보관만 (keep_page).
// vault는 Query로만 읽고, 트랜잭션을 열기 전에 읽는다 (vault와 한 트랜잭션에 묶지 않는다).
@Injectable()
export class BasketService extends BaseService {
  private static readonly ADD = 'add_basket_item';
  private static readonly KEEP = 'keep_page';
  /** 읽은 글의 민감정보 무늬가 받는 칸 이름 */
  private static readonly PAGE_TEXT = 'page';

  constructor(
    db: Database,
    private readonly sessions: SessionQuery,
    private readonly posts: PostQuery,
    private readonly sensitive: SensitivePolicy,
  ) {
    super(db);
  }

  /**
   * 페이지 보관 (2차 4단계): 링크 소재 하나, 읽은 글은 메모로 (민감정보를 지운 뒤). 같은 주소를 이미 담았으면 그 소재(duplicate).
   * 같은 request_id는 처음 답 그대로
   */
  async keep(actor: Actor, req: KeepPageInput): Promise<KeptPageView> {
    actor.assertCan(Actor.UPLOAD);
    // 에이전트도 upload를 가질 수 있지만 소재는 사람이 고른 것만 (브라우저 확장 · 연결된 기기)
    if (actor.kind !== 'device') throw new RuleViolation('페이지 보관은 연결된 기기에서만 해요');
    const spaceId = actor.requireSpace();
    const [note] = req.text ? this.sensitive.scrub(BasketService.PAGE_TEXT, req.text) : [null];
    return this.transaction(async (tx) => {
      const items = new BasketRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, BasketService.KEEP);
      const before = await once.previous();
      if (before) return (await items.load(spaceId, String(before.itemId))).keptView(true);
      const basketId = await items.defaultBasket(spaceId);
      const found = await items.linkOf(basketId, req.url);
      if (found) return found.keptView(true);
      const fields = { kind: BasketItem.LINK, url: req.url, title: req.title, note: note || null };
      const item = BasketItem.open(basketId, fields, actor, new Date());
      await items.save(item);
      await once.remember({ itemId: item.id });
      return item.keptView(false);
    });
  }

  /** 같은 requestId가 다시 오면 처음 담은 소재를 돌려준다. 첫 소재면 기본 상자를 만든다 */
  async add(actor: Actor, req: AddBasketItemInput): Promise<BasketItem> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const title = req.fields.title ?? (await this.titleOf(actor, req));
    return this.transaction(async (tx) => {
      const items = new BasketRepository(tx);
      const once = new Idempotency(tx, actor.id ?? spaceId, req.requestId, BasketService.ADD);
      const before = await once.previous();
      if (before) return items.load(spaceId, String(before.itemId));
      const basketId = await items.defaultBasket(spaceId);
      const item = BasketItem.open(basketId, { ...req.fields, title }, actor, new Date());
      await items.save(item);
      await once.remember({ itemId: item.id });
      return item;
    });
  }

  /** 소재만 지운다. 가리키던 세션·글은 그대로다 */
  async remove(actor: Actor, id: string): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction(async (tx) => {
      const items = new BasketRepository(tx);
      await items.remove(await items.lock(spaceId, id));
    });
  }

  /** 가리키는 세션·글의 제목. 없거나 볼 수 없으면 NotFound. 링크·메모는 가리키는 것이 없다 */
  private async titleOf(actor: Actor, req: AddBasketItemInput): Promise<string | null> {
    const { kind, ref_id: refId } = req.fields;
    if (kind === BasketItem.SESSION) {
      const session = GetSessionInput.from({ session_id: refId });
      return (await this.sessions.note(actor, session)).summary.title;
    }
    if (kind === BasketItem.POST)
      return (await this.posts.editable(actor, ReadPostInput.from(refId ?? ''))).title;
    return null;
  }
}
