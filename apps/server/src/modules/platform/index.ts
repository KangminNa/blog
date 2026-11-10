// platform 모듈의 공개 API. 다른 모듈은 이 파일로만 platform을 쓴다.

export { ArchiveQuery } from './archive/archive.query';
export { ArchiveFile } from './archive/archive-file';
export { ArchiveBlob, ArchivePart, ArchiveReport } from './archive/archive-part';
export { ArchiveRecord } from './archive/archive-record';
export { ArchiveRestoreService } from './archive/archive-restore.service';
export {
  Actor,
  AgentActor,
  ApprovedActor,
  DeviceActor,
  OwnerActor,
  SystemActor,
  VisitorActor,
} from './base/actor';
export { AttemptLimiter } from './base/attempt-limiter';
export { ActionResult, BaseAction } from './base/base-action';
export { BaseEntity } from './base/base-entity';
export { BaseGateway } from './base/base-gateway';
export { BaseHandler } from './base/base-handler';
export { BaseJob } from './base/base-job';
export { BaseLogin, LoginIdentity } from './base/base-login';
export { BaseQuery } from './base/base-query';
export { BaseRepository } from './base/base-repository';
export { BaseRequest, type ColumnReaders, RequestFields, VersionInput } from './base/base-request';
export { BaseService, EntityService, type VersionTarget } from './base/base-service';
export { BaseTool, type ToolAnswer } from './base/base-tool';
export { Blob, BlobStore } from './base/blob-store';
export { Database, type Row, type Sql } from './base/database';
export {
  Conflict,
  DomainError,
  ExternalFailure,
  Forbidden,
  InvalidRequest,
  NotFound,
  RuleViolation,
  TooLarge,
  TooManyRequests,
  Unauthenticated,
  UnsupportedType,
} from './base/errors';
export { DomainEvent } from './base/event';
export { FileSniff } from './base/file-sniff';
export { Idempotency } from './base/idempotency';
export { McpEndpoint } from './base/mcp-endpoint';
export { Command, Operation, Read, Work } from './base/operation';
export { ChangeSignal, Outbox } from './base/outbox';
export { PasswordHasher } from './base/password-hasher';
export { SealedSecret, SecretBox } from './base/secret-box';
export { SecretRotation } from './base/secret-rotation';
export { Redaction, SensitivePolicy } from './base/sensitive-policy';
export * as TableColumns from './base/table-columns';
export { type ColumnRules, TableEntity, type TableRow } from './base/table-entity';
export { type How, type RowOf, Rule, type Where } from './base/table-query';
export { type EntityStore, TableRepository } from './base/table-repository';
export { ZipFile } from './base/zip-file';
export { ZipLimits, ZipReader } from './base/zip-reader';
export { Cookies } from './http/cookies';
export { CurrentActor } from './http/current-actor';
export { HttpSetup } from './http/http-setup';
export type { HttpRequest, HttpResponse } from './http/http-types';
export { PlatformModule } from './platform.module';
export { BasePlugin } from './plugin/base-plugin';
export { PackageService } from './plugin/package.service';
export { PackageTool } from './plugin/package.tool';
export { PluginService } from './plugin/plugin.service';
export type { PluginContext } from './plugin/plugin-context';
export { LoginMethod } from './plugin/plugin-context';
export { PluginManifest } from './plugin/plugin-manifest';
export { PluginRegistry } from './plugin/plugin-registry';
export { ChangeStream } from './stream/change-stream';
export { CoreWorkers } from './worker/core-workers';
export { OutboxWorker } from './worker/outbox-worker';
