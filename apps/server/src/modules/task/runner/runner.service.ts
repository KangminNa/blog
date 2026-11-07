import { Injectable } from '@nestjs/common';
import { type Actor, EntityService, type Sql } from '../../platform';
import type { Runner } from './runner';
import type { RunnerAcceptingInput } from './runner.input';
import { RunnerRepository } from './runner.repository';

// 러너 쓰기: 주인이 일 받기를 켜고 끈다. 러너가 닿은 때는 작업 쪽(TaskService)이 적는다.
@Injectable()
export class RunnerService extends EntityService<Runner> {
  protected store(tx: Sql): RunnerRepository {
    return new RunnerRepository(tx);
  }

  /** 본 version이 지금과 다르면 409 */
  setAccepting(actor: Actor, req: RunnerAcceptingInput): Promise<Runner> {
    return this.changeAsOwner(actor, req, (runner) => runner.setAccepting(req.accepting));
  }
}
