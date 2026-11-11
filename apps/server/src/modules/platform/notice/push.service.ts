import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import { Database } from '../base/database';
import { NotFound } from '../base/errors';
import { PushMessage } from './notice.policy';
import { PushGateway } from './push.gateway';
import type { PushEndpointInput, SubscribePushInput } from './push.input';
import { PushRepository } from './push.repository';
import { PushTestView } from './push.view';
import { PushSubscription } from './push-subscription';

// 브라우저 푸시 쓰기 (7단계): 이 브라우저 구독 · 끊기 · 보내 보기. 주인만.
// 보내 보기는 바깥(푸시 서비스)에 닿으므로 트랜잭션 밖에서 보내고, 결과만 짧은 트랜잭션에 적는다.
@Injectable()
export class PushService extends BaseService {
  constructor(
    db: Database,
    private readonly gateway: PushGateway,
  ) {
    super(db);
  }

  async subscribe(actor: Actor, req: SubscribePushInput): Promise<void> {
    actor.assertOwner();
    const subscription = PushSubscription.open(
      actor.requireSpace(),
      actor.id ?? '',
      req.endpoint,
      req.p256dh,
      req.auth,
      null,
      PushSubscription.extraOrigins(process.env),
    );
    await this.transaction((tx) => new PushRepository(tx).upsert(subscription));
  }

  async unsubscribe(actor: Actor, req: PushEndpointInput): Promise<void> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    await this.transaction((tx) => new PushRepository(tx).remove(spaceId, req.endpoint));
  }

  /** 이 브라우저로 보내 보기. 이 공간에 그 구독이 없으면 404 */
  async test(actor: Actor, req: PushEndpointInput): Promise<PushTestView> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const [target] = await new PushRepository(this.db.sql).targets(spaceId, req.endpoint);
    if (!target) throw new NotFound('이 브라우저는 알림을 받고 있지 않아요');
    const now = new Date();
    const status = await this.gateway.send(
      target,
      new PushMessage('Cairn 알림 시험', '이 브라우저로 알림이 와요', '/admin/notices', 'test'),
      now,
    );
    await this.transaction((tx) =>
      new PushRepository(tx).record(target.id, status, now, PushSubscription.FAILS_MAX),
    );
    const ok = status >= 200 && status < 300;
    return new PushTestView(ok ? 1 : 0, ok ? 0 : 1);
  }
}
