import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import { CreateGoalRunInput, GoalRunIdInput, ListGoalRunsInput } from './goal-run.input';
import { GoalRunQuery } from './goal-run.query';
import { GoalRunService } from './goal-run.service';
import type { GoalRunDetailView, GoalRunListView, GoalRunView } from './goal-run.view';

// 목표 실행 (콘솔 운영 › 목표). 모두 주인만 (Service · Query 첫 줄에서 확인).
// 주인은 시작하고 멈추기만 한다. 사이의 일은 회차 루프와 결재(api/approvals)로 진행된다.
@Controller('api/goal-runs')
export class GoalRunController {
  constructor(
    private readonly query: GoalRunQuery,
    private readonly service: GoalRunService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<GoalRunListView> {
    return this.query.list(actor, ListGoalRunsInput.from(query));
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<GoalRunDetailView> {
    return this.query.get(actor, GoalRunIdInput.from(id));
  }

  @Post()
  async start(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<GoalRunView> {
    return (await this.service.start(actor, CreateGoalRunInput.from(body))).view();
  }

  @HttpCode(200)
  @Post(':id/stop')
  async stop(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<GoalRunView> {
    const req = VersionInput.from(id, body);
    return (await this.service.stop(actor, req.id, req.version)).view();
  }
}
