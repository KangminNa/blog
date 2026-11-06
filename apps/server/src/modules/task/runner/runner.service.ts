import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Forbidden } from '../../platform';
import type { Runner } from './runner';
import type { RunnerAcceptingInput } from './runner.input';
import { RunnerRepository } from './runner.repository';

// 러너 쓰기: 주인이 일 받기를 켜고 끈다. 러너가 닿은 때는 작업 쪽(TaskService)이 적는다.
@Injectable()
export class RunnerService extends BaseService {
  /** 본 version이 지금과 다르면 409 */
  async setAccepting(actor: Actor, req: RunnerAcceptingInput): Promise<Runner> {
    actor.assertOwner();
    if (!actor.spaceId) throw new Forbidden('owner');
    const spaceId = actor.spaceId;
    return this.transaction(async (tx) => {
      const runners = new RunnerRepository(tx);
      const runner = await runners.lock(spaceId, req.id);
      runner.assertVersion(req.version);
      runner.setAccepting(req.accepting);
      await runners.save(runner);
      return runner;
    });
  }
}
