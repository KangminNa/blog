import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import { CreateAgentInput, UpdateAgentInput } from './agent.input';
import { AgentQuery } from './agent.query';
import { AgentService } from './agent.service';
import type { AgentListView, AgentRevisionListView, AgentSavedView } from './agent.view';

// 에이전트 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
// 바꾼 뒤에는 에이전트 하나를 돌려주고, 화면은 그 version으로 다음 변경을 보낸다.
@Controller('api/agents')
export class AgentController {
  constructor(
    private readonly agents: AgentQuery,
    private readonly service: AgentService,
  ) {}

  /** 설정 판 목록 (새 판부터) */
  @Get(':id/revisions')
  revisions(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<AgentRevisionListView> {
    return this.agents.revisions(actor, id);
  }

  @Get()
  list(@CurrentActor() actor: Actor): Promise<AgentListView> {
    return this.agents.list(actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<AgentSavedView> {
    return (await this.service.create(actor, CreateAgentInput.from(body))).view();
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentSavedView> {
    return (await this.service.update(actor, UpdateAgentInput.from(id, body))).view();
  }

  @HttpCode(200)
  @Post(':id/pause')
  async pause(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentSavedView> {
    return (await this.service.pause(actor, VersionInput.from(id, body))).view();
  }

  @HttpCode(200)
  @Post(':id/resume')
  async resume(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentSavedView> {
    return (await this.service.resume(actor, VersionInput.from(id, body))).view();
  }
}
