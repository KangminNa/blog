import { type Actor, BaseEntity, TrackedEntity } from '../../platform';

// 소재 하나 (work.basket_items). 글을 쓰려고 모아 두는 세션·글·링크·메모.
// 세션·글은 id만 값으로 갖고(외래키 없음) 글과 연결을 저장하지 않는다.
// 사진·파일은 올리는 길이 아직 없어서 받지 않는다. 표의 종류에는 있다 (테이블설계 5장).
export class BasketItem extends TrackedEntity {
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

  private constructor(
    id: string,
    readonly basketId: string,
    readonly kind: string,
    readonly refId: string | null,
    readonly url: string | null,
    readonly title: string | null,
    readonly note: string | null,
    readonly actorType: string,
    readonly actorId: string | null,
    readonly createdAt: Date,
  ) {
    super(id, 1);
  }

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
      BaseEntity.newId(),
      basketId,
      kind,
      refId,
      url,
      title,
      note,
      BasketItem.ACTOR_TYPE,
      by.id,
      now,
    );
  }

  static restore(
    id: string,
    basketId: string,
    kind: string,
    refId: string | null,
    url: string | null,
    title: string | null,
    note: string | null,
    actorType: string,
    actorId: string | null,
    createdAt: Date,
  ): BasketItem {
    return new BasketItem(
      id,
      basketId,
      kind,
      refId,
      url,
      title,
      note,
      actorType,
      actorId,
      createdAt,
    );
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
}
