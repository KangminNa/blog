import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Task } from '../task/task';
import { ChatUpdateService } from './chat-update.service';

// 작업이 끝나면(task.task.changed의 완료 · 실패) 대화의 소식을 남긴다. 대화의 일인지 · 무슨 소식인지는 서비스가 본다
@Injectable()
export class ChatUpdateHandler extends BaseHandler {
  private static readonly SETTLED: readonly string[] = [Task.DONE, Task.FAILED];

  constructor(private readonly updates: ChatUpdateService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!ChatUpdateHandler.SETTLED.includes(String(event.data.status))) return;
    await this.updates.noteSettled(new SystemActor(), String(event.data.taskId));
  }
}
