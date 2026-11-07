import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { BasketQuery } from './basket.query';
import type { ToolBasketView } from './basket.view';

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

  handle(actor: Actor): Promise<ToolBasketView> {
    return this.basket.forWriting(actor);
  }
}
