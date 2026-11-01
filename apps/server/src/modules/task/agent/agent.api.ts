import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import type { Agent } from './agent';
import { AgentVersionInput, CreateAgentInput, UpdateAgentInput } from './agent.input';
import { AgentQuery } from './agent.query';
import { AgentService } from './agent.service';
import type { AgentListView } from './agent.view';

/** 에이전트 목록 */
export class AgentListResponse extends BaseResponse {
  private constructor(private readonly view: AgentListView) {
    super();
  }

  static of(view: AgentListView): AgentListResponse {
    return new AgentListResponse(view);
  }

  toJSON(): object {
    return this.view.toJSON();
  }
}

/** 바꾼 에이전트 하나. 화면은 이 version으로 다음 변경을 보낸다 */
export class AgentResponse extends BaseResponse {
  private constructor(private readonly agent: Agent) {
    super();
  }

  static of(agent: Agent): AgentResponse {
    return new AgentResponse(agent);
  }

  toJSON(): object {
    const a = this.agent;
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      tool: a.tool,
      scopes: a.scopes,
      approvalActions: a.approvalActions,
      monthlyLimit: a.monthlyLimit,
      fiveHourLimit: a.fiveHourLimit,
      planStopPercent: a.planStopPercent,
      status: a.status,
      version: a.version,
      createdAt: a.createdAt.toISOString(),
    };
  }
}

// 에이전트 메뉴. 주인만 (Service·Query 첫 줄에서 확인).
@Controller('api/agents')
export class AgentController {
  constructor(
    private readonly agents: AgentQuery,
    private readonly service: AgentService,
  ) {}

  @Get()
  async list(@CurrentActor() actor: Actor): Promise<AgentListResponse> {
    return AgentListResponse.of(await this.agents.list(actor));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<AgentResponse> {
    return AgentResponse.of(await this.service.create(actor, CreateAgentInput.from(body)));
  }

  @Patch(':id')
  async update(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentResponse> {
    return AgentResponse.of(await this.service.update(actor, UpdateAgentInput.from(id, body)));
  }

  @HttpCode(200)
  @Post(':id/pause')
  async pause(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentResponse> {
    return AgentResponse.of(await this.service.pause(actor, AgentVersionInput.from(id, body)));
  }

  @HttpCode(200)
  @Post(':id/resume')
  async resume(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentResponse> {
    return AgentResponse.of(await this.service.resume(actor, AgentVersionInput.from(id, body)));
  }
}
