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

/**
 * 페이지 보관 (MCP keep_page, 2차 4단계): 브라우저 확장이 지금 페이지의 주소 · 제목 · 읽은 글을 보낸다.
 * 링크 소재가 되고 글은 메모 칸에 (민감정보를 지운 뒤). 같은 request_id는 한 번만
 */
export class KeepPageInput extends BaseRequest {
  private constructor(
    readonly requestId: string,
    readonly url: string,
    readonly title: string,
    readonly text: string | null,
  ) {
    super();
  }

  static from(raw: unknown): KeepPageInput {
    return BaseRequest.read(raw, (f) => {
      const url = BasketItem.linkOf(f.text('url', BasketItem.URL_MAX));
      if (!url) f.reject('url', 'http나 https 주소여야 해요');
      return new KeepPageInput(
        f.uuid('request_id'),
        url ?? '',
        f.text('title', BasketItem.TITLE_MAX),
        f.optionalText('text', BasketItem.NOTE_MAX),
      );
    });
  }
}
