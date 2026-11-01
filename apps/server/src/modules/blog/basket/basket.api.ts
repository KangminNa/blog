import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { BasketItem } from './basket';
import { AddBasketItemInput, BasketItemIdInput } from './basket.input';
import { BasketQuery } from './basket.query';
import { BasketService } from './basket.service';
import { BasketItemView, type BasketView } from './basket.view';

/** 소재 목록 */
export class BasketResponse extends BaseResponse {
  private constructor(private readonly view: BasketView) {
    super();
  }

  static of(view: BasketView): BasketResponse {
    return new BasketResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 담은 소재 하나 */
export class BasketItemResponse extends BaseResponse {
  private constructor(private readonly item: BasketItem) {
    super();
  }

  static of(item: BasketItem): BasketItemResponse {
    return new BasketItemResponse(item);
  }

  toJSON(): object {
    const i = this.item;
    return new BasketItemView(i.id, i.kind, i.refId, i.url, i.title, i.note, i.createdAt).toJSON();
  }
}

// 소재 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/basket/items')
export class BasketController {
  constructor(
    private readonly basket: BasketQuery,
    private readonly service: BasketService,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<BasketResponse> {
    return BasketResponse.of(await this.basket.list(actor));
  }

  @Post()
  async add(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<BasketItemResponse> {
    return BasketItemResponse.of(await this.service.add(actor, AddBasketItemInput.from(body)));
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<void> {
    await this.service.remove(actor, BasketItemIdInput.from(id).id);
  }
}
