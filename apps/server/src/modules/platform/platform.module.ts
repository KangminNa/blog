import { resolve } from 'node:path';
import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ArchiveQuery } from './archive/archive.query';
import { ArchiveRestoreService } from './archive/archive-restore.service';
import { BlobStore } from './base/blob-store';
import { Database } from './base/database';
import { SecretBox } from './base/secret-box';
import { SecretRotation } from './base/secret-rotation';
import { HealthController } from './health/health.api';
import { HealthQuery } from './health/health.query';
import { DomainErrorFilter } from './http/domain-error.filter';
import { PluginController } from './plugin/plugin.api';
import { PluginQuery } from './plugin/plugin.query';
import { PluginService } from './plugin/plugin.service';
import { PluginRegistry } from './plugin/plugin-registry';
import { ChangeStream } from './stream/change-stream';
import { StreamController } from './stream/stream.api';
import { CoreWorkers } from './worker/core-workers';
import { OutboxWorker } from './worker/outbox-worker';

// 공통 기반. 비즈니스 규칙을 두지 않는다. 다른 모듈은 index.ts로만 가져다 쓴다.
@Global()
@Module({
  providers: [
    Database,
    BlobStore,
    HealthQuery,
    PluginQuery,
    PluginService,
    { provide: SecretBox, useFactory: () => SecretBox.fromEnv(process.env) },
    SecretRotation,
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
  controllers: [HealthController, PluginController, StreamController],
  exports: [
    Database,
    BlobStore,
    SecretBox,
    SecretRotation,
    PluginRegistry,
    PluginService,
    ArchiveQuery,
    ArchiveRestoreService,
    ChangeStream,
    CoreWorkers,
    OutboxWorker,
  ],
})
export class PlatformModule implements OnModuleInit {
  constructor(
    private readonly rotation: SecretRotation,
    private readonly plugins: PluginService,
  ) {}

  onModuleInit(): void {
    this.rotation.register('플러그인 설정', (actor) => this.plugins.resealSecrets(actor));
  }
}
