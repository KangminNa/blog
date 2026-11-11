import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { CurrentActor } from '../http/current-actor';
import { ReadNotificationsInput } from './notification.input';
import { NotificationQuery } from './notification.query';
import { NotificationService } from './notification.service';
import type { NotificationListView, NotificationsReadView } from './notification.view';

// 콘솔 머리줄의 알림 (주인만). 무엇을 알리는지는 알리는 모듈이 정하고, 여기서는 보여 주고 읽음으로 바꾸기만 한다.
@Controller('api/notifications')
export class NotificationController {
  constructor(
    private readonly notifications: NotificationQuery,
    private readonly service: NotificationService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<NotificationListView> {
    return this.notifications.list(actor);
  }

  /** { ids? } 없으면 모두 */
  @Post('read')
  @HttpCode(200)
  read(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<NotificationsReadView> {
    return this.service.read(actor, ReadNotificationsInput.from(body));
  }
}
