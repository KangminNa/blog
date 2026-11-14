import { Injectable } from '@nestjs/common';
import { Actor, BaseTool } from '../../platform';
import { KeepPageInput } from './basket.input';
import { BasketQuery } from './basket.query';
import { BasketService } from './basket.service';
import type { KeptPageView, ToolBasketView } from './basket.view';

// AI가 글을 쓸 때 읽는 소재. 비공개 자료가 담기므로 write 권한으로만 열린다.
@Injectable()
export class BasketGetTool extends BaseTool {
  readonly name = 'basket_get';
  readonly scope = Actor.WRITE;
  readonly readOnly = true;
  readonly inputSchema = { properties: {} };

  constructor(private readonly basket: BasketQuery) {
    super();
  }

  handle(actor: Actor): Promise<ToolBasketView> {
    return this.basket.forWriting(actor);
  }
}

// MCP 도구 keep_page: 브라우저 확장의 "이 페이지 보관" (2차 4단계). 지금 페이지를 링크 소재로 담는다. upload 권한
@Injectable()
export class KeepPageTool extends BaseTool {
  readonly name = 'keep_page';
  readonly scope = Actor.UPLOAD;
  readonly readOnly = false;
  override readonly idempotent = true;
  readonly inputSchema = {
    properties: {
      request_id: { type: 'string', format: 'uuid' },
      url: { type: 'string', maxLength: 2000 },
      title: { type: 'string', maxLength: 200 },
      text: { type: 'string', maxLength: 10_000 },
    },
    required: ['request_id', 'url', 'title'],
  };

  constructor(private readonly basket: BasketService) {
    super();
  }

  handle(actor: Actor, raw: unknown): Promise<KeptPageView> {
    return this.basket.keep(actor, KeepPageInput.from(raw));
  }
}
