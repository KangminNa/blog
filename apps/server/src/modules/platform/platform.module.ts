import { resolve } from 'node:path';
import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ArchiveQuery } from './archive/archive.query';
import { ArchiveRestoreService } from './archive/archive-restore.service';
import { BlobStore } from './base/blob-store';
import { Database } from './base/database';
import { Outbox } from './base/outbox';
import { SecretBox } from './base/secret-box';
import { SecretRotation } from './base/secret-rotation';
import { SensitivePolicy } from './base/sensitive-policy';
import { HealthController } from './health/health.api';
import { HealthQuery } from './health/health.query';
import { DomainErrorFilter } from './http/domain-error.filter';
import { NoticeCatalog } from './notice/notice-catalog';
import { NoticePushJob } from './notice/notice-push.job';
import { NoticePushService } from './notice/notice-push.service';
import { NoticeSettingsController } from './notice/notice-settings.api';
import { NoticeSettingsQuery } from './notice/notice-settings.query';
import { NoticeSettingsService } from './notice/notice-settings.service';
import { NotificationController } from './notice/notification.api';
import { NotificationQuery } from './notice/notification.query';
import { NotificationService } from './notice/notification.service';
import { PushController } from './notice/push.api';
import { PushGateway } from './notice/push.gateway';
import { PushQuery } from './notice/push.query';
import { PushService } from './notice/push.service';
import { Leases } from './plugin/leases';
import { PackageController } from './plugin/package.api';
import { PackageService } from './plugin/package.service';
import { PluginController } from './plugin/plugin.api';
import { PluginQuery } from './plugin/plugin.query';
import { PluginService } from './plugin/plugin.service';
import { PluginRegistry } from './plugin/plugin-registry';
import { ChangeStream } from './stream/change-stream';
import { StreamController } from './stream/stream.api';
import { BlobSweepJob } from './worker/blob-sweep.job';
import { CoreWorkers } from './worker/core-workers';
import { OutboxWorker } from './worker/outbox-worker';

// 공통 기반. 비즈니스 규칙을 두지 않는다. 다른 모듈은 index.ts로만 가져다 쓴다.
@Global()
@Module({
  providers: [
    PackageService,
    Leases,
    Database,
    BlobStore,
    BlobSweepJob,
    HealthQuery,
    NotificationQuery,
    NotificationService,
    NoticeCatalog,
    NoticeSettingsQuery,
    NoticeSettingsService,
    PushGateway,
    PushQuery,
    PushService,
    NoticePushService,
    NoticePushJob,
    PluginQuery,
    PluginService,
    { provide: SecretBox, useFactory: () => SecretBox.fromEnv(process.env) },
    SecretRotation,
    SensitivePolicy,
    ArchiveQuery,
    ArchiveRestoreService,
    ChangeStream,
    CoreWorkers,
    OutboxWorker,
    {
      // 들어 있는 플러그인을 시작할 때 모두 읽고(목록 파일이 틀리면 서버가 뜨지 않음), 켜짐·설정은 DB에서
      provide: PluginRegistry,
      useFactory: (
        db: Database,
        archive: ArchiveQuery,
        box: SecretBox,
        restore: ArchiveRestoreService,
      ) =>
        PluginRegistry.boot(
          process.env.CAIRN_PLUGINS_DIR ?? resolve(process.cwd(), '../../plugins'),
          db.sql,
          archive,
          box,
          restore,
        ),
      inject: [Database, ArchiveQuery, SecretBox, ArchiveRestoreService],
    },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
  controllers: [
    HealthController,
    NotificationController,
    NoticeSettingsController,
    PushController,
    PluginController,
    PackageController,
    StreamController,
  ],
  exports: [
    Database,
    BlobStore,
    SecretBox,
    SecretRotation,
    SensitivePolicy,
    PluginRegistry,
    PluginService,
    PackageService,
    Leases,
    ArchiveQuery,
    ArchiveRestoreService,
    ChangeStream,
    CoreWorkers,
    OutboxWorker,
    NoticeCatalog,
  ],
})
export class PlatformModule implements OnModuleInit {
  constructor(
    private readonly rotation: SecretRotation,
    private readonly plugins: PluginService,
    private readonly workers: CoreWorkers,
    private readonly sweep: BlobSweepJob,
    private readonly notices: NoticeCatalog,
    private readonly push: NoticePushJob,
  ) {}

  onModuleInit(): void {
    // 모듈이 등록한 알림 종류로, 이벤트를 남기는 같은 트랜잭션에서 알림도 남긴다
    Outbox.listen('notices', (tx, events) => this.notices.onEvents(tx, events));
    this.rotation.register('플러그인 설정', (actor) => this.plugins.resealSecrets(actor));
    this.workers.every(this.sweep, BlobSweepJob.EVERY_MS);
    this.workers.every(this.push, NoticePushJob.EVERY_MS);
  }
}
