import { Injectable } from '@nestjs/common';
import type { Actor } from '../base/actor';
import { BaseService } from '../base/base-service';
import { Database } from '../base/database';
import { NoticePolicy } from './notice.policy';
import { NoticeCatalog } from './notice-catalog';
import { NoticeSettingsRepository } from './notice-settings.repository';
import { PushGateway } from './push.gateway';
import { PushRepository } from './push.repository';
import { PushSubscription } from './push-subscription';

// 알림을 브라우저 푸시로 보낸다 (7단계, 일꾼이 1분마다). 공간마다:
//   짧은 트랜잭션: 아직 다루지 않은 알림을 잠그고(SKIP LOCKED) NoticePolicy로 정한 뒤, 다룬 것으로 적는다
//   트랜잭션 밖: 구독마다 보낸다 (먼저 적으므로 많아야 한 번 간다. 닿지 못한 푸시는 다시 보내지 않는다)
//   짧은 트랜잭션: 구독마다 결과를 적는다 (사라진 구독 · 실패가 쌓인 구독은 지운다)
// 구독이 없는 공간도 다룬 것으로 적는다: 나중에 구독해도 지난 알림이 한꺼번에 울리지 않게.
@Injectable()
export class NoticePushService extends BaseService {
  /** 한 차례에 공간 하나에서 다루는 알림 수 */
  private static readonly BATCH = 200;
  private readonly policy = new NoticePolicy();

  constructor(
    db: Database,
    private readonly catalog: NoticeCatalog,
    private readonly gateway: PushGateway,
  ) {
    super(db);
  }

  /** 보낸 푸시 수 */
  async run(actor: Actor): Promise<number> {
    actor.assertOwnerOrSystem();
    let sent = 0;
    for (const spaceId of await new PushRepository(this.db.sql).pendingSpaces())
      sent += await this.runSpace(spaceId);
    return sent;
  }

  private async runSpace(spaceId: string): Promise<number> {
    const now = new Date();
    const kinds = this.catalog.all();
    const { plan, targets } = await this.transaction(async (tx) => {
      const store = new PushRepository(tx);
      const pending = await store.lockPending(spaceId, NoticePushService.BATCH);
      const settings = await new NoticeSettingsRepository(tx).load(spaceId);
      const decided = this.policy.decide(pending, settings, kinds, now);
      await store.markHandled(decided.handled, now);
      return { plan: decided, targets: await store.targets(spaceId) };
    });
    if (plan.messages.length === 0 || targets.length === 0) return 0;
    const results: [string, number][] = [];
    for (const target of targets)
      for (const message of plan.messages)
        results.push([target.id, await this.gateway.send(target, message, now)]);
    await this.transaction(async (tx) => {
      const store = new PushRepository(tx);
      for (const [id, status] of results)
        await store.record(id, status, now, PushSubscription.FAILS_MAX);
    });
    return results.filter(([, status]) => status >= 200 && status < 300).length;
  }
}
