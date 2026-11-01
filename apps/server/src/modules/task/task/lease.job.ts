import { Injectable } from '@nestjs/common';
import { BaseJob, SystemActor } from '../../platform';
import { TaskService } from './task.service';

// 임대가 끝난 작업을 되돌린다. 러너가 하나도 없어도 세 번 끝난 작업이 실패로 보이게 일꾼이 돈다.
@Injectable()
export class LeaseJob extends BaseJob {
  readonly name = 'task.leases';

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async run(): Promise<void> {
    await this.tasks.reclaim(new SystemActor());
  }
}
