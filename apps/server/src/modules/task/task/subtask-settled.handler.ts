import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Task } from './task';
import { TaskService } from './task.service';

// 작업이 끝날 때마다(task.task.changed) 그것이 하위 작업이면 위 작업을 깨울지 본다.
// 위 작업이 하위 작업을 기다리고 있고 형제가 모두 끝났으면 대기열로 돌린다. 두 번 와도 같다.
@Injectable()
export class SubtaskSettledHandler extends BaseHandler {
  private static readonly SETTLED: readonly string[] = [Task.DONE, Task.FAILED, Task.CANCELLED];

  constructor(private readonly tasks: TaskService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (!SubtaskSettledHandler.SETTLED.includes(String(event.data.status))) return;
    await this.tasks.settleSubtask(new SystemActor(), String(event.data.taskId));
  }
}
