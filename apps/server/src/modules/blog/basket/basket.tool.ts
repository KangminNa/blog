import { Injectable } from '@nestjs/common';
import { Actor, BaseResponse, BaseTool } from '../../platform';
import { BasketQuery } from './basket.query';
import type { BasketView } from './basket.view';

/** basket_get의 답. MCP는 snake_case */
export class ToolBasketResponse extends BaseResponse {
  private constructor(private readonly view: BasketView) {
    super();
  }

  static of(view: BasketView): ToolBasketResponse {
    return new ToolBasketResponse(view);
  }

  toJSON(): object {
    return {
      items: this.view.items.map((i) => ({
        id: i.id,
        kind: i.kind,
        ref_id: i.refId,
        url: i.url,
        title: i.title,
        note: i.note,
        created_at: i.createdAt.toISOString(),
      })),
    };
  }
}

// AI가 글을 쓸 때 읽는 소재. 비공개 자료가 담기므로 write 권한으로만 열린다.
@Injectable()
export class BasketGetTool extends BaseTool {
  readonly name = 'basket_get';
  readonly scope = Actor.WRITE;
  readonly readOnly = true;
  readonly description = [
    '주인이 글을 쓰려고 모아 둔 소재를 읽는다: 세션, 글, 링크, 메모.',
    '세션과 글은 ref_id로 가리키니 내용은 get_session이나 blog_get_post로 읽는다.',
  ].join(' ');
  readonly inputSchema = { properties: {} };

  constructor(private readonly basket: BasketQuery) {
    super();
  }

  async handle(actor: Actor): Promise<ToolBasketResponse> {
    return ToolBasketResponse.of(await this.basket.forWriting(actor));
  }
}
