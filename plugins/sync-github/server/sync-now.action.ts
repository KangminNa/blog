import { type ActionResult, Actor, BaseAction } from '../../../apps/server/src/plugin-api';
import type { SyncJob } from './sync.job';

// 지금 동기화: 5분을 기다리지 않고 바로 한 번 맞춘다.
export class SyncNowAction extends BaseAction {
  readonly label = '지금 동기화';

  constructor(private readonly job: SyncJob) {
    super();
  }

  async run(actor: Actor): Promise<ActionResult> {
    actor.assertCan(Actor.WRITE);
    return this.job.syncOnce();
  }
}
