import { Body, Controller, Get, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { SetProjectRuleInput } from './project-rule.input';
import { ProjectRuleQuery } from './project-rule.query';
import { ProjectRuleService } from './project-rule.service';
import type { ProjectRuleListView } from './project-rule.view';

// 프로젝트별 세션 원문 모으기 (2차 4단계). 관리자만 (Service · Query 첫 줄에서 확인)
@Controller('api/project-rules')
export class ProjectRuleController {
  constructor(
    private readonly query: ProjectRuleQuery,
    private readonly service: ProjectRuleService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<ProjectRuleListView> {
    return this.query.list(actor);
  }

  /** 켜거나 끈 뒤의 목록 */
  @Put()
  async set(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<ProjectRuleListView> {
    await this.service.set(actor, SetProjectRuleInput.from(body));
    return this.query.list(actor);
  }
}
