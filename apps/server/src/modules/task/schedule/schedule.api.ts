import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import type { TaskView } from '../task/task.view';
import { CreateScheduleInput, ListSchedulesInput, UpdateScheduleInput } from './schedule.input';
import { ScheduleQuery } from './schedule.query';
import { ScheduleService } from './schedule.service';
import type { ScheduleListView, ScheduleView } from './schedule.view';

// 스케줄 (7단계, 콘솔 자동화 › 스케줄). 모두 주인만 (Service · Query 첫 줄에서 확인).
// 고친 스케줄은 목록의 한 줄과 같은 모양이고, 화면은 그 version으로 다음 변경을 보낸다.
@Controller('api/schedules')
export class ScheduleController {
  constructor(
    private readonly query: ScheduleQuery,
    private readonly service: ScheduleService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<ScheduleListView> {
    return this.query.list(actor, ListSchedulesInput.from(query));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<ScheduleView> {
    return (await this.service.create(actor, CreateScheduleInput.from(body))).view();
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ScheduleView> {
    return (await this.service.update(actor, UpdateScheduleInput.from(id, body))).view();
  }

  /** 지금 한 번 (하루 한도에 함께 센다). 만든 작업 */
  @HttpCode(200)
  @Post(':id/run')
  async run(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TaskView> {
    return (await this.service.runNow(actor, VersionInput.from(id, body))).view();
  }

  @HttpCode(204)
  @Post(':id/delete')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.service.remove(actor, VersionInput.from(id, body));
  }
}
