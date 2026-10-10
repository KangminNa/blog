import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Database } from '../base/database';
import { DomainEvent } from '../base/event';
import type { ScheduledJob } from '../plugin/plugin-context';
import { PluginRegistry } from '../plugin/plugin-registry';

// 일꾼: outbox에 쌓인 이벤트를 받는 쪽(Handler)에 넘기고, 플러그인의 반복 작업을 돌린다. (진입 계층)
//   빌리기    한 문장으로 최대 50개를 고르며 다음 시도 시각을 2분 뒤로 미뤄 둔다 (다른 일꾼과 겹치지 않음)
//   넘기기    트랜잭션 밖에서 Handler를 차례로 부른다 (외부 호출이 있어도 잠금을 잡고 있지 않음)
//   결과      모두 성공 → processed_at / 실패 → 점점 늦게 다시 / 8번 실패 → failed_at (지우지 않음)
// 일꾼은 하나만 띄운다. 반복 작업은 앞 실행이 안 끝났으면 건너뛴다.
@Injectable()
export class OutboxWorker implements OnApplicationShutdown {
  private static readonly BATCH = 50;
  private static readonly MAX_ATTEMPTS = 8;
  private readonly logger = new Logger('일꾼');
  private readonly timers: NodeJS.Timeout[] = [];
  private jobTimers: NodeJS.Timeout[] = [];
  private readonly runningJobs = new Set<string>();
  private ticking = false;

  constructor(
    private readonly db: Database,
    private readonly registry: PluginRegistry,
  ) {}

  start(pollMs = 1000): void {
    this.timers.push(setInterval(() => void this.tickSafely(), pollMs));
    this.scheduleJobs();
    this.logger.log('시작했어요');
  }

  /** 지금 켜진 플러그인의 반복 작업으로 일정을 다시 짠다 */
  private scheduleJobs(): void {
    for (const t of this.jobTimers) clearInterval(t);
    this.jobTimers = this.registry.jobs().map((scheduled) => {
      this.logger.log(
        `반복 작업: ${scheduled.plugin}/${scheduled.job.name} (${scheduled.everyMs / 1000}초마다)`,
      );
      return setInterval(() => void this.runJob(scheduled), scheduled.everyMs);
    });
  }

  /** 한 번 돌린다. 처리한 이벤트 수를 돌려준다 (테스트에서 직접 부른다) */
  async tick(): Promise<number> {
    const rows = await this.db.sql`
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
      const event = DomainEvent.fromOutbox(String(row.topic), String(row.space_id), row.payload);
      try {
        // 플러그인을 켜거나 끄거나 설정을 바꾸면: 재시작 없이 다시 등록하고 일정을 다시 짠다
        if (event.name === 'platform.plugin.changed') {
          await this.registry.reload();
          if (this.timers.length > 0) this.scheduleJobs();
        }
        for (const sub of this.registry.handlersFor(event)) await sub.handler.handle(event);
        await this.db
          .sql`UPDATE platform.outbox SET processed_at = now(), last_error = NULL WHERE id = ${row.id}`;
      } catch (error) {
        await this.fail(Number(row.id), Number(row.attempts), error);
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

  onApplicationShutdown(): void {
    for (const t of [...this.timers, ...this.jobTimers]) clearInterval(t);
    this.timers.length = 0;
    this.jobTimers = [];
  }

  private async tickSafely(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`이벤트를 읽지 못했어요: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
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
