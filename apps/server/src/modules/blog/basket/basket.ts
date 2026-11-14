import { type Actor, BaseEntity, TableEntity } from '../../platform';
import type { BasketItemNew, BasketItemRow } from '../blog.tables';
import { BasketItemView, KeptPageView } from './basket.view';

// 소재 하나 (work.basket_items). 글을 쓰려고 모아 두는 세션·글·링크·메모.
// 세션·글은 id만 값으로 갖고(외래키 없음) 글과 연결을 저장하지 않는다.
// 사진·파일은 올리는 길이 아직 없어서 받지 않는다. 표의 종류에는 있다 (테이블설계 5장).
// 담고 지우기만 한다: 담은 뒤에 바꾸는 칸이 없다.
// 브라우저 확장이 보관한 페이지(keep_page, 2차 4단계)는 링크로 담고 읽은 글은 메모 칸에 둔다. 같은 주소는 한 번만.
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
  /** 담은 쪽 (basket_items.actor_type): 주인은 콘솔에서, 기기는 브라우저 확장의 "이 페이지 보관"으로 (keep_page) */
  private static readonly ACTOR_TYPES: Readonly<Record<string, string>> = {
    owner: 'user',
    device: 'device',
  };

  /** 종류마다 필요한 칸(세션·글의 id, 링크, 메모)은 입력이 맞춰 온다 */
  static open(basketId: string, fields: Partial<BasketItemRow>, by: Actor, now: Date): BasketItem {
    return new BasketItem(
      {
        kind: '',
        ...fields,
        id: BaseEntity.newId(),
        basket_id: basketId,
        actor_type: BasketItem.ACTOR_TYPES[by.kind] ?? 'system',
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

  /** 페이지 보관의 답. duplicate: 같은 주소를 이미 담아 새로 담지 않았다 */
  keptView(duplicate: boolean): KeptPageView {
    return new KeptPageView(this.id, duplicate ? 'duplicate' : 'saved');
  }
}
