import { Injectable } from '@nestjs/common';
import { BaseJob, SystemActor } from '../../platform';
import { HeartbeatService } from './heartbeat.service';

// 1분마다 때가 된 하트비트를 깨운다. 두 번 돌아도(일꾼이 둘이어도) 같은 시각의 작업은 하나다.
@Injectable()
export class HeartbeatJob extends BaseJob {
  readonly name = 'task.heartbeats';

  constructor(private readonly heartbeats: HeartbeatService) {
    super();
  }

  async run(): Promise<void> {
    await this.heartbeats.runDue(new SystemActor());
  }
}
