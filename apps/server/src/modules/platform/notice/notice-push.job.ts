import { Injectable } from '@nestjs/common';
import { SystemActor } from '../base/actor';
import { BaseJob } from '../base/base-job';
import { NoticePushService } from './notice-push.service';

// 1분마다 알림을 브라우저 푸시로 보낸다 (즉시는 바로, 묶음은 묶음 시각에, 조용한 시간에는 미룸).
// 두 번 돌아도(일꾼이 둘이어도) 같은 알림은 한 번만 다룬다 (잠그고 먼저 적는다).
@Injectable()
export class NoticePushJob extends BaseJob {
  static readonly EVERY_MS = 60_000;
  readonly name = 'platform.notice-push';

  constructor(private readonly push: NoticePushService) {
    super();
  }

  async run(): Promise<void> {
    await this.push.run(new SystemActor());
  }
}
