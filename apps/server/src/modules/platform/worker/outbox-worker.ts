import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { SystemActor } from '../base/actor';
import { Database } from '../base/database';
import { DomainEvent } from '../base/event';
import { Outbox } from '../base/outbox';
import type { OutboxRow } from '../platform.tables';
import { Leases } from '../plugin/leases';
import { PackageService } from '../plugin/package.service';
import type { ScheduledJob } from '../plugin/plugin-context';
import { PluginRegistry } from '../plugin/plugin-registry';
import { CoreWorkers } from './core-workers';

// 일꾼: outbox에 쌓인 이벤트를 받는 쪽(Handler)에 넘기고, 코어와 플러그인의 반복 작업을 돌린다. (진입 계층)
//   깨우기    저장이 커밋되면 오는 신호(LISTEN)로 바로 돈다. 놓친 신호와 다시 시도는 30초마다 한 번 더 돌아 줍는다
//   빌리기    한 문장으로 최대 50개를 고르며 다음 시도 시각을 2분 뒤로 미뤄 둔다 (다른 일꾼과 겹치지 않음)
//   넘기기    트랜잭션 밖에서 Handler를 차례로 부른다 (외부 호출이 있어도 잠금을 잡고 있지 않음)
//   결과      모두 성공 → processed_at / 실패 → 점점 늦게 다시 / 8번 실패 → failed_at (지우지 않음)
// 일꾼은 하나만 띄운다. 반복 작업은 앞 실행이 안 끝났으면 건너뛴다.
@Injectable()
export class OutboxWorker implements OnApplicationShutdown {
  private static readonly BATCH = 50;
  private static readonly MAX_ATTEMPTS = 8;
  private static readonly FALLBACK_MS = 30_000;
  private readonly logger = new Logger('일꾼');
  private readonly timers: NodeJS.Timeout[] = [];
  private jobTimers: NodeJS.Timeout[] = [];
  private readonly runningJobs = new Set<string>();
  private listening: Promise<(() => Promise<void>) | null> | null = null;
  private draining = false;
  private wanted = false;
  private closing = false;

  /** 기능 패키지가 이벤트에 건 동작을 돌린다 (REST · MCP와 같은 순서: 권한 → 입력 → 트랜잭션 → outbox) */
  private readonly packages: PackageService;

  constructor(
    private readonly db: Database,
    private readonly registry: PluginRegistry,
    private readonly core: CoreWorkers,
    /** 이벤트로 도는 패키지 동작에는 러너가 없어 쓰지 않지만, 동작을 돌리는 길이 같아 함께 넘긴다 */
    leases: Leases = new Leases(),
  ) {
    this.packages = new PackageService(db, registry, leases);
  }

  start(fallbackMs = OutboxWorker.FALLBACK_MS): void {
    const missing = this.core.missing();
    if (missing.length > 0) throw new Error(`받는 쪽이 없는 필수 이벤트: ${missing.join(', ')}`);
    this.timers.push(setInterval(() => this.wake(), fallbackMs));
    this.scheduleJobs();
    this.listen();
    this.logger.log('시작했어요');
  }

  /** 신호를 듣는다. 듣기를 마칠 때마다(다시 연결 포함) 깨워서 듣기 전에 쌓인 이벤트를 처리한다 */
  private listen(): void {
    const wake = () => this.wake();
    this.listening = this.db.listen(Outbox.CHANNEL, wake, wake).catch((error: unknown) => {
      this.logger.warn(`신호를 듣지 못해 주기로만 확인해요: ${(error as Error).message}`);
      return null;
    });
  }

  /** 코어의 반복 작업과 지금 켜진 플러그인의 반복 작업으로 일정을 다시 짠다 */
  private scheduleJobs(): void {
    for (const t of this.jobTimers) clearInterval(t);
    this.jobTimers = [...this.core.jobs(), ...this.registry.jobs()].map((scheduled) => {
      this.logger.log(
        `반복 작업: ${scheduled.plugin}/${scheduled.job.name} (${scheduled.everyMs / 1000}초마다)`,
      );
      return setInterval(() => void this.runJob(scheduled), scheduled.everyMs);
    });
  }

  /** 한 번 돌린다. 처리한 이벤트 수를 돌려준다 (테스트에서 직접 부른다) */
  async tick(): Promise<number> {
    const rows = await this.db.sql<
      Pick<OutboxRow, 'id' | 'space_id' | 'topic' | 'payload' | 'attempts'>[]
    >`
      UPDATE platform.outbox o
         SET attempts = o.attempts + 1, next_attempt_at = now() + interval '2 minutes'
       WHERE o.id IN (
         SELECT id FROM platform.outbox
          WHERE processed_at IS NULL AND failed_at IS NULL
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY id LIMIT ${OutboxWorker.BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING o.id, o.space_id, o.topic, o.payload, o.attempts`;
    for (const row of rows) {
      try {
        // Outbox.publish가 적은 객체 ({ v, ...data })
        const payload = row.payload as Record<string, unknown>;
        const event = DomainEvent.fromOutbox(row.topic, row.space_id, payload);
        // 플러그인을 켜거나 끄거나 설정을 바꾸면: 재시작 없이 다시 등록하고 일정을 다시 짠다
        if (event.name === 'platform.plugin.changed') {
          await this.registry.reload();
          if (this.timers.length > 0) this.scheduleJobs();
        }
        for (const handler of this.core.handlersFor(event)) await handler.handle(event);
        for (const sub of this.registry.handlersFor(event)) await sub.handler.handle(event);
        for (const reaction of this.registry.reactionsFor(event))
          await this.packages.run(new SystemActor(), reaction.found, {
            ...event.data,
            spaceId: event.spaceId,
          });
        await this.db
          .sql`UPDATE platform.outbox SET processed_at = now(), last_error = NULL WHERE id = ${row.id}`;
      } catch (error) {
        await this.fail(row.id, row.attempts, error);
      }
    }
    return rows.length;
  }

  async runJob(scheduled: ScheduledJob): Promise<void> {
    const key = `${scheduled.plugin}/${scheduled.job.name}`;
    if (this.runningJobs.has(key)) return;
    this.runningJobs.add(key);
    try {
      await scheduled.job.run();
    } catch (error) {
      this.logger.warn(`${key} 실패: ${(error as Error).message}`);
    } finally {
      this.runningJobs.delete(key);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    for (const t of [...this.timers, ...this.jobTimers]) clearInterval(t);
    this.timers.length = 0;
    this.jobTimers = [];
    const unlisten = await this.listening;
    // Database도 함께 닫히는 중이라 실패할 수 있다. 연결이 닫히면 듣기도 끝나므로 넘어간다
    await unlisten?.().catch(() => {});
  }

  /**
   * 도는 중에 온 신호는 wanted에 남아 이번 바퀴가 끝난 뒤 한 번 더 돌게 한다.
   * 내려간 뒤의 신호는 무시한다: 다시 연결한 적이 있으면 듣기를 끝내도 신호가 계속 올 수 있다.
   */
  private wake(): void {
    if (this.closing) return;
    this.wanted = true;
    void this.drain();
  }

  /** 할 일이 없을 때까지 돈다. 꽉 찬 묶음 뒤에는 남은 이벤트가 있을 수 있어 다음 주기를 기다리지 않는다 */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let count: number;
      do {
        this.wanted = false;
        count = await this.tick();
      } while (!this.closing && (this.wanted || count === OutboxWorker.BATCH));
    } catch (error) {
      this.logger.warn(`이벤트를 읽지 못했어요: ${(error as Error).message}`);
    } finally {
      this.draining = false;
    }
  }

  private async fail(id: number, attempts: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (attempts >= OutboxWorker.MAX_ATTEMPTS) {
      await this.db
        .sql`UPDATE platform.outbox SET failed_at = now(), last_error = ${message} WHERE id = ${id}`;
      this.logger.error(`이벤트 ${id}를 ${attempts}번 실패해서 멈췄어요: ${message}`);
      return;
    }
    const waitSeconds = Math.min(3600, 10 * 2 ** attempts);
    await this.db.sql`
      UPDATE platform.outbox
         SET next_attempt_at = now() + ${waitSeconds} * interval '1 second', last_error = ${message}
       WHERE id = ${id}`;
  }
}
