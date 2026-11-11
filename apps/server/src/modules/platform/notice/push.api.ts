import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { PushEndpointInput, SubscribePushInput } from './push.input';
import { PushQuery } from './push.query';
import { PushService } from './push.service';
import type { PushKeyView, PushTestView } from './push.view';

// 브라우저 푸시 (7단계, 콘솔 자동화 › 알림의 "이 브라우저"): 공개 키 · 구독 · 끊기 · 보내 보기. 주인만.
@Controller('api/push')
export class PushController {
  constructor(
    private readonly query: PushQuery,
    private readonly service: PushService,
  ) {}

  @Get('key')
  key(@CurrentActor() actor: Actor): Promise<PushKeyView> {
    return this.query.key(actor);
  }

  @HttpCode(204)
  @Post('subscriptions')
  async subscribe(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<void> {
    await this.service.subscribe(actor, SubscribePushInput.from(body));
  }

  @HttpCode(204)
  @Post('subscriptions/delete')
  async unsubscribe(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<void> {
    await this.service.unsubscribe(actor, PushEndpointInput.from(body));
  }

  @HttpCode(200)
  @Post('test')
  test(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<PushTestView> {
    return this.service.test(actor, PushEndpointInput.from(body));
  }
}
