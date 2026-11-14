import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import {
  CreateAgentInput,
  DeleteAgentInput,
  ListAgentsInput,
  UpdateAgentInput,
} from './agent.input';
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

  /** 쓰는 에이전트. ?deleted=1이면 휴지통의 에이전트 */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: unknown): Promise<AgentListView> {
    return this.agents.list(actor, ListAgentsInput.from(query));
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

  /** 휴지통으로 (지우지 않는다). { version, team? } */
  @HttpCode(200)
  @Post(':id/delete')
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentSavedView> {
    return (await this.service.delete(actor, DeleteAgentInput.from(id, body))).view();
  }

  @HttpCode(200)
  @Post(':id/restore')
  async restore(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentSavedView> {
    return (await this.service.restore(actor, VersionInput.from(id, body))).view();
  }
}
