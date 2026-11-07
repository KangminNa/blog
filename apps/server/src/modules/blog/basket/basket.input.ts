import { BaseRequest, type RequestFields } from '../../platform';
import type { BasketItemRow } from '../blog.tables';
import { BasketItem } from './basket';

/**
 * POST /api/basket/items. 같은 requestId는 처음 담은 소재를 돌려준다.
 * 종류마다 필요한 칸이 다르다: 세션·글은 refId, 링크는 url, 메모는 note.
 * 칸을 읽는 법이 종류에 달려 있어 칸마다 한 줄인 COLUMNS로 적지 않는다.
 */
export class AddBasketItemInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly fields: Partial<BasketItemRow>,
  ) {
    super();
  }

  static from(raw: unknown): AddBasketItemInput {
    return BaseRequest.read(raw, (f) => {
      const kind = f.text('kind', 20);
      if (kind && !BasketItem.KINDS.includes(kind))
        f.reject('kind', `${BasketItem.KINDS.join(' · ')} 중 하나예요`);
      const refers = kind === BasketItem.SESSION || kind === BasketItem.POST;
      return new AddBasketItemInput(f.uuid('requestId'), {
        kind,
        ref_id: refers ? f.uuid('refId') : null,
        url: kind === BasketItem.LINK ? AddBasketItemInput.link(f) : null,
        title: f.optionalText('title', BasketItem.TITLE_MAX),
        note: AddBasketItemInput.note(f, kind),
      });
    });
  }

  private static link(f: RequestFields): string | null {
    const url = BasketItem.linkOf(f.text('url', BasketItem.URL_MAX));
    if (!url) f.reject('url', 'http나 https 주소여야 해요');
    return url;
  }

  /** 메모는 글자가 꼭 있어야 하고, 다른 종류에는 덧붙이는 칸이다 */
  private static note(f: RequestFields, kind: string): string | null {
    const note = f.optionalText('note', BasketItem.NOTE_MAX)?.trim() || null;
    if (kind === BasketItem.NOTE && !note) f.reject('note', '메모를 적어 주세요');
    return note;
  }
}

/** DELETE /api/basket/items/:id */
export class BasketItemIdInput extends BaseRequest {
  private constructor(readonly id: string) {
    super();
  }

  static from(id: string): BasketItemIdInput {
    return BaseRequest.read({ id }, (f) => new BasketItemIdInput(f.uuid('id')));
  }
}
