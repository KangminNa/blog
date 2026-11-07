import { type Actor, BaseEntity, TableEntity } from '../../platform';
import type { BasketItemNew, BasketItemRow } from '../blog.tables';
import { BasketItemView } from './basket.view';

// 소재 하나 (work.basket_items). 글을 쓰려고 모아 두는 세션·글·링크·메모.
// 세션·글은 id만 값으로 갖고(외래키 없음) 글과 연결을 저장하지 않는다.
// 사진·파일은 올리는 길이 아직 없어서 받지 않는다. 표의 종류에는 있다 (테이블설계 5장).
// 담고 지우기만 한다: 담은 뒤에 바꾸는 칸이 없다.
export class BasketItem extends TableEntity<BasketItemRow, BasketItemNew> {
  static readonly SESSION = 'session';
  static readonly POST = 'post';
  static readonly LINK = 'link';
  static readonly NOTE = 'note';
  static readonly KINDS: readonly string[] = [
    BasketItem.SESSION,
    BasketItem.POST,
    BasketItem.LINK,
    BasketItem.NOTE,
  ];
  static readonly TITLE_MAX = 200;
  static readonly NOTE_MAX = 10_000;
  static readonly URL_MAX = 2000;
  private static readonly PROTOCOLS: readonly string[] = ['http:', 'https:'];
  /** 소재는 주인만 담는다 (basket_items.actor_type) */
  private static readonly ACTOR_TYPE = 'user';

  static open(
    basketId: string,
    kind: string,
    refId: string | null,
    url: string | null,
    title: string | null,
    note: string | null,
    by: Actor,
    now: Date,
  ): BasketItem {
    return new BasketItem(
      {
        id: BaseEntity.newId(),
        basket_id: basketId,
        kind,
        ref_id: refId,
        url,
        title,
        note,
        actor_type: BasketItem.ACTOR_TYPE,
        actor_id: by.id,
        created_at: now,
      },
      true,
    );
  }

  static restore(row: BasketItemRow): BasketItem {
    return new BasketItem(row);
  }

  /** 담을 수 있는 링크면 다듬은 주소, 아니면 null. http·https만: javascript: 같은 주소가 화면의 링크가 되지 않게 */
  static linkOf(raw: string): string | null {
    try {
      const url = new URL(raw.trim());
      return BasketItem.PROTOCOLS.includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  /** 담은 소재 하나 */
  view(): BasketItemView {
    return new BasketItemView(this.row);
  }
}
