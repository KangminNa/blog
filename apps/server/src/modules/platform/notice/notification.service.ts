import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import { Notices } from './notices';
import type { ReadNotificationsInput } from './notification.input';
import { NotificationsReadView } from './notification.view';

// 알림 쓰기 중 주인이 하는 것: 읽음. 알림을 남기는 것은 각 모듈이 자기 트랜잭션에서 Notices로 한다.
@Injectable()
export class NotificationService extends BaseService {
  read(actor: Actor, req: ReadNotificationsInput): Promise<NotificationsReadView> {
    actor.assertOwner();
    const space = actor.requireSpace();
    return this.transaction(
      async (tx) =>
        new NotificationsReadView(await new Notices(tx).read(space, req.ids, new Date())),
    );
  }
}
