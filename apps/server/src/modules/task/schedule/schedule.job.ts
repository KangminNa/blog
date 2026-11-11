import { Injectable } from '@nestjs/common';
import { BaseJob, SystemActor } from '../../platform';
import { ScheduleService } from './schedule.service';

// 1분마다 때가 된 스케줄을 돌린다. 두 번 돌아도(일꾼이 둘이어도) 같은 시각의 작업은 하나다.
@Injectable()
export class ScheduleJob extends BaseJob {
  readonly name = 'task.schedules';

  constructor(private readonly schedules: ScheduleService) {
    super();
  }

  async run(): Promise<void> {
    await this.schedules.runDue(new SystemActor());
  }
}
