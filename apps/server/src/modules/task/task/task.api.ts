import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import { CreateTaskInput, ListTasksInput, TaskIdInput } from './task.input';
import { TaskQuery } from './task.query';
import { TaskService } from './task.service';
import type { TaskDetailView, TaskPageView, TaskView } from './task.view';

// 작업 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
// 바꾼 작업은 목록의 한 줄과 같은 모양이고, 화면은 그 version으로 다음 변경을 보낸다.
@Controller('api/tasks')
export class TaskController {
  constructor(
    private readonly tasks: TaskQuery,
    private readonly service: TaskService,
  ) {}

  /** ?status=running · ?cursor=<앞 응답의 next> */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<TaskPageView> {
    return this.tasks.list(actor, ListTasksInput.from(query));
  }

  /** 작업 하나 + 실행 기록 */
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<TaskDetailView> {
    return this.tasks.get(actor, TaskIdInput.from(id));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<TaskView> {
    return (await this.service.create(actor, CreateTaskInput.from(body))).view();
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TaskView> {
    return (await this.service.cancel(actor, VersionInput.from(id, body))).view();
  }
}
