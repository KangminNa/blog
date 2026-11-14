import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ChatResultService } from './chat-result.service';

// 대화의 일이 바뀌면(작업 상태 · 결재 요청) 결과 결재의 다음을 정한다 (2차 2단계). 대화의 일인지 · 가라앉았는지는 서비스가 본다
@Injectable()
export class ChatResultHandler extends BaseHandler {
  static readonly TOPICS: readonly string[] = ['task.task.changed', 'task.approval.requested'];

  constructor(private readonly results: ChatResultService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const taskId = event.data.taskId;
    if (typeof taskId !== 'string') return;
    await this.results.settle(new SystemActor(), event.spaceId, taskId);
  }
}
