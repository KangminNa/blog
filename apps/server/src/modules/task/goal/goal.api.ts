import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Goal } from './goal';
import { CreateGoalInput, GoalStatusInput, UpdateGoalInput } from './goal.input';
import { GoalQuery } from './goal.query';
import { GoalService } from './goal.service';
import { type GoalListView, GoalView } from './goal.view';

/** 목표 전부 */
export class GoalListResponse extends BaseResponse {
  private constructor(private readonly view: GoalListView) {
    super();
  }

  static of(view: GoalListView): GoalListResponse {
    return new GoalListResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 만들거나 고친 목표 하나. 작업 수는 목록에서만 센다 (0). 화면은 이 version으로 다음 변경을 보낸다 */
export class GoalResponse extends BaseResponse {
  private constructor(private readonly goal: Goal) {
    super();
  }

  static of(goal: Goal): GoalResponse {
    return new GoalResponse(goal);
  }

  toJSON(): object {
    const g = this.goal;
    return new GoalView(
      g.id,
      g.parentId,
      g.title,
      g.description,
      g.status,
      g.sort,
      0,
      0,
      g.version,
      g.createdAt,
    ).toJSON();
  }
}

// 목표 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/goals')
export class GoalController {
  constructor(
    private readonly query: GoalQuery,
    private readonly service: GoalService,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<GoalListResponse> {
    return GoalListResponse.of(await this.query.list(actor));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<GoalResponse> {
    return GoalResponse.of(await this.service.create(actor, CreateGoalInput.from(body)));
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalResponse> {
    return GoalResponse.of(await this.service.update(actor, UpdateGoalInput.from(id, body)));
  }

  /** 끝내기 · 그만두기 · 다시 열기 */
  @HttpCode(200)
  @Post(':id/status')
  async status(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalResponse> {
    return GoalResponse.of(await this.service.changeStatus(actor, GoalStatusInput.from(id, body)));
  }
}
