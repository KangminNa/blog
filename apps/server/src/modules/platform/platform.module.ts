import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ArchiveQuery } from './archive/archive.query';
import { Database } from './base/database';
import { SecretBox } from './base/secret-box';
import { HealthController } from './health/health.controller';
import { HealthQuery } from './health/health.query';
import { DomainErrorFilter } from './http/domain-error.filter';
import { PluginController } from './plugin/plugin.controller';
import { PluginQuery } from './plugin/plugin.query';
import { PluginService } from './plugin/plugin.service';
import { PluginRegistry } from './plugin/plugin-registry';
import { OutboxWorker } from './worker/outbox-worker';

// 공통 기반. 비즈니스 규칙을 두지 않는다. 다른 모듈은 index.ts로만 가져다 쓴다.
@Global()
@Module({
  providers: [
    Database,
    HealthQuery,
    PluginQuery,
    PluginService,
    { provide: SecretBox, useFactory: () => SecretBox.fromEnv(process.env) },
    ArchiveQuery,
    OutboxWorker,
    {
      // 들어 있는 플러그인을 시작할 때 모두 읽고(목록 파일이 틀리면 서버가 뜨지 않음), 켜짐·설정은 DB에서
      provide: PluginRegistry,
      useFactory: (db: Database, archive: ArchiveQuery, box: SecretBox) =>
        PluginRegistry.boot(
          process.env.CAIRN_PLUGINS_DIR ?? resolve(process.cwd(), '../../plugins'),
          db.sql,
          archive,
          box,
        ),
      inject: [Database, ArchiveQuery, SecretBox],
    },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
  controllers: [HealthController, PluginController],
  exports: [Database, SecretBox, PluginRegistry, PluginService, ArchiveQuery, OutboxWorker],
})
export class PlatformModule {}
