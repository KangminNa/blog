import type { ArchiveQuery } from '../archive/archive.query';
import type { ArchiveFile } from '../archive/archive-file';
import { SystemActor } from '../base/actor';
import type { BaseAction } from '../base/base-action';
import type { BaseHandler } from '../base/base-handler';
import type { BaseJob } from '../base/base-job';
import type { PluginManifest } from './plugin-manifest';

/** 등록된 이벤트 받기 하나 */
export class EventSubscription {
  constructor(
    readonly plugin: string,
    readonly pattern: string,
    readonly handler: BaseHandler,
  ) {}
}

/** 등록된 반복 작업 하나 */
export class ScheduledJob {
  constructor(
    readonly plugin: string,
    readonly job: BaseJob,
    readonly everyMs: number,
  ) {}
}

/** 등록된 관리 동작 하나 */
export class PluginAction {
  constructor(
    readonly plugin: string,
    readonly name: string,
    readonly action: BaseAction,
  ) {}
}

// 플러그인이 확장 지점에 등록하는 창구. 목록 파일 `uses`에 적지 않은 것을 쓰면 그 플러그인은 켜지지 않는다.
export class PluginContext {
  readonly subscriptions: EventSubscription[] = [];
  readonly jobs: ScheduledJob[] = [];
  readonly actions: PluginAction[] = [];

  constructor(
    private readonly manifest: PluginManifest,
    private readonly values: ReadonlyMap<string, string>,
    private readonly archive: ArchiveQuery,
  ) {}

  /** 자기 설정 값 전부 (비밀값은 풀어서, 비어 있으면 기본값). 다른 플러그인의 설정은 볼 수 없다 */
  settings(): ReadonlyMap<string, string> {
    return this.values;
  }

  onEvent(pattern: string, handler: BaseHandler): void {
    this.require(`event:${pattern}`);
    this.subscriptions.push(new EventSubscription(this.manifest.name, pattern, handler));
  }

  /** every('30s' | '5m' | '1h', job) */
  every(interval: string, job: BaseJob): void {
    this.require(`job:${job.name}`);
    this.jobs.push(
      new ScheduledJob(this.manifest.name, job, PluginContext.parseInterval(interval)),
    );
  }

  addAction(name: string, action: BaseAction): void {
    this.require(`action:${name}`);
    this.actions.push(new PluginAction(this.manifest.name, name, action));
  }

  /** 보관 형식 파일을 읽는 함수. 서버 자신의 자격으로 읽으므로 목록 파일에 archive:read가 있어야 한다 */
  archiveReader(): () => Promise<readonly ArchiveFile[]> {
    this.require('archive:read');
    return () => this.archive.files(new SystemActor());
  }

  private require(use: string): void {
    if (!this.manifest.allows(use)) {
      throw new Error(
        `플러그인 ${this.manifest.name}이(가) 목록 파일에 없는 확장 지점을 쓰려 해요: ${use}`,
      );
    }
  }

  private static parseInterval(interval: string): number {
    const m = /^(\d+)(s|m|h)$/.exec(interval);
    if (!m) throw new Error(`간격 형식이 아니에요: ${interval} (예: 30s, 5m, 1h)`);
    const ms = Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000 }[m[2] as 's' | 'm' | 'h'];
    if (ms < 10_000) throw new Error(`간격은 10초 이상이어야 해요: ${interval}`);
    return ms;
  }
}
