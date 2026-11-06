import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Task } from './task';
import { CancelTaskInput, CreateTaskInput, ListTasksInput, TaskIdInput } from './task.input';
import { TaskQuery } from './task.query';
import { TaskService } from './task.service';
import { type TaskDetailView, type TaskPageView, TaskView } from './task.view';

/** 작업 목록 한 쪽 */
export class TaskPageResponse extends BaseResponse {
  private constructor(private readonly page: TaskPageView) {
    super();
  }

  static of(page: TaskPageView): TaskPageResponse {
    return new TaskPageResponse(page);
  }

  toJSON(): object {
    return this.page.toJSON();
  }
}

/** 작업 하나 + 실행 기록 */
export class TaskDetailResponse extends BaseResponse {
  private constructor(private readonly detail: TaskDetailView) {
    super();
  }

  static of(detail: TaskDetailView): TaskDetailResponse {
    return new TaskDetailResponse(detail);
  }

  toJSON(): object {
    return this.detail.toJSON();
  }
}

/** 바꾼 작업 하나. 목록의 한 줄과 같은 모양이고, 화면은 이 version으로 다음 변경을 보낸다 */
export class TaskResponse extends BaseResponse {
  private constructor(private readonly task: Task) {
    super();
  }

  static of(task: Task): TaskResponse {
    return new TaskResponse(task);
  }

  toJSON(): object {
    const t = this.task;
    return new TaskView(
      t.id,
      t.agentId,
      t.kind,
      t.title,
      t.status,
      t.priority,
      t.targetKind,
      t.targetId,
      t.baseVersion,
      t.attempts,
      t.leaseUntil,
      t.version,
      t.createdAt,
      t.finishedAt,
      null,
      t.goalId,
      t.parentId,
      t.waitReason,
    ).toJSON();
  }
}

// 작업 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/tasks')
export class TaskController {
  constructor(
    private readonly tasks: TaskQuery,
    private readonly service: TaskService,
  ) {}

  /** ?status=running · ?cursor=<앞 응답의 next> */
  @Get()
  async list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<TaskPageResponse> {
    return TaskPageResponse.of(await this.tasks.list(actor, ListTasksInput.from(query)));
  }

  @Get(':id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<TaskDetailResponse> {
    return TaskDetailResponse.of(await this.tasks.get(actor, TaskIdInput.from(id)));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<TaskResponse> {
    return TaskResponse.of(await this.service.create(actor, CreateTaskInput.from(body)));
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TaskResponse> {
    return TaskResponse.of(await this.service.cancel(actor, CancelTaskInput.from(id, body)));
  }
}
