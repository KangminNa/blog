import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { CreateGoalInput, GoalStatusInput, UpdateGoalInput } from './goal.input';
import { GoalQuery } from './goal.query';
import { GoalService } from './goal.service';
import type { GoalListView, GoalView } from './goal.view';

// 목표 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
// 만들거나 고친 뒤에는 목표 하나를 돌려주고, 화면은 그 version으로 다음 변경을 보낸다.
@Controller('api/goals')
export class GoalController {
  constructor(
    private readonly query: GoalQuery,
    private readonly service: GoalService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<GoalListView> {
    return this.query.list(actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<GoalView> {
    return (await this.service.create(actor, CreateGoalInput.from(body))).view();
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalView> {
    return (await this.service.update(actor, UpdateGoalInput.from(id, body))).view();
  }

  /** 끝내기 · 그만두기 · 다시 열기 */
  @HttpCode(200)
  @Post(':id/status')
  async status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalView> {
    return (await this.service.changeStatus(actor, GoalStatusInput.from(id, body))).view();
  }
}
