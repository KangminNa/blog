import { Injectable } from '@nestjs/common';
import { BaseJob, SystemActor } from '../../platform';
import { OutputService } from './output.service';

// 휴지통 기간(30일)이 지난 결과물을 지운다. 파일은 아무도 쓰지 않게 되면 platform의 BlobSweepJob이 지운다.
@Injectable()
export class OutputPurgeJob extends BaseJob {
  static readonly EVERY_MS = 60 * 60 * 1000;
  readonly name = 'task.outputs';

  constructor(private readonly outputs: OutputService) {
    super();
  }

  async run(): Promise<void> {
    await this.outputs.purgeExpired(new SystemActor(), new Date());
  }
}
