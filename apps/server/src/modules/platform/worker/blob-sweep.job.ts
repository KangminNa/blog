import { Injectable } from '@nestjs/common';
import { SystemActor } from '../base/actor';
import { BaseJob } from '../base/base-job';
import { BlobStore } from '../base/blob-store';

// 아무 모듈도 가리키지 않는 파일을 지운다 (BlobStore.sweep). 7일을 기다린다: 저장한 뒤 행을 남기기 전의 파일,
// 휴지통을 비운 바로 뒤 되살릴 수도 있는 파일을 지우지 않게.
@Injectable()
export class BlobSweepJob extends BaseJob {
  static readonly EVERY_MS = 6 * 60 * 60 * 1000;
  private static readonly KEEP_MS = 7 * 24 * 60 * 60 * 1000;
  readonly name = 'platform.blobs';

  constructor(private readonly blobs: BlobStore) {
    super();
  }

  async run(): Promise<void> {
    await this.blobs.sweep(new SystemActor(), new Date(Date.now() - BlobSweepJob.KEEP_MS));
  }
}
