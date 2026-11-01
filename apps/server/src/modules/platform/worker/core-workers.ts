import { Injectable } from '@nestjs/common';
import type { BaseHandler } from '../base/base-handler';
import type { BaseJob } from '../base/base-job';
import type { DomainEvent } from '../base/event';
import { EventSubscription, ScheduledJob } from '../plugin/plugin-context';

// 코어 모듈이 일꾼에게 이벤트 받기와 반복 작업을 맡기는 자리. 모듈은 onModuleInit에서 등록한다.
// 받는 쪽이 없는 이벤트는 처리됨으로 넘어가 사라진다. 꼭 받아야 하는 주제는 expect로 적어 두면 일꾼이 뜰 때 잡는다.
@Injectable()
export class CoreWorkers {
  private static readonly OWNER = 'core';
  private readonly subscriptions: EventSubscription[] = [];
  private readonly scheduled: ScheduledJob[] = [];
  private readonly expected = new Set<string>();

  on(pattern: string, handler: BaseHandler): void {
    this.subscriptions.push(new EventSubscription(CoreWorkers.OWNER, pattern, handler));
  }

  every(job: BaseJob, everyMs: number): void {
    this.scheduled.push(new ScheduledJob(CoreWorkers.OWNER, job, everyMs));
  }

  /** 이 주제는 코어에 받는 쪽이 있어야 한다 */
  expect(topic: string): void {
    this.expected.add(topic);
  }

  handlersFor(event: DomainEvent): readonly BaseHandler[] {
    return this.subscriptions.filter((s) => event.matches(s.pattern)).map((s) => s.handler);
  }

  jobs(): readonly ScheduledJob[] {
    return this.scheduled;
  }

  /** 받는 쪽이 없는 필수 주제 */
  missing(): readonly string[] {
    return [...this.expected].filter(
      (topic) => !this.subscriptions.some((s) => CoreWorkers.covers(s.pattern, topic)),
    );
  }

  private static covers(pattern: string, topic: string): boolean {
    return pattern === topic || (pattern.endsWith('.*') && topic.startsWith(pattern.slice(0, -1)));
  }
}
