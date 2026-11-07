import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { AddBasketItemInput, BasketItemIdInput } from './basket.input';
import { BasketQuery } from './basket.query';
import { BasketService } from './basket.service';
import type { BasketItemView, BasketView } from './basket.view';

// 소재 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/basket/items')
export class BasketController {
  constructor(
    private readonly basket: BasketQuery,
    private readonly service: BasketService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<BasketView> {
    return this.basket.list(actor);
  }

  /** 담은 소재 하나 */
  @Post()
  async add(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<BasketItemView> {
    return (await this.service.add(actor, AddBasketItemInput.from(body))).view();
  }

  @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<void> {
    await this.service.remove(actor, BasketItemIdInput.from(id).id);
  }
}
