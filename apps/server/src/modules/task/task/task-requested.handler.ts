import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { CreateTaskInput } from './task.input';
import { TaskService } from './task.service';

// 어느 모듈이든 task.task.requested 이벤트로 일을 요청한다. 내용의 requestId로 작업은 하나만 생긴다.
@Injectable()
export class TaskRequestedHandler extends BaseHandler {
  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.tasks.request(new SystemActor(), event.spaceId, CreateTaskInput.from(event.data));
  }
}
