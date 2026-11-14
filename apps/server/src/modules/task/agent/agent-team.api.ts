import { Body, Controller, Get, Post } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import { CreateAgentTeamInput } from './agent.input';
import { AgentQuery } from './agent.query';
import { AgentService } from './agent.service';
import { type AgentTeamListView, AgentTeamSavedView } from './agent.view';

// 에이전트 팀 템플릿 (에이전트 메뉴의 팀 템플릿). 주인만 (Service · Query 첫 줄에서 확인).
// 템플릿은 코드에 있고(AgentTeams), 만들기는 팀 하나를 한 번에: 역할 · 권한 · 조직도까지.
@Controller('api/agent-teams')
export class AgentTeamController {
  constructor(
    private readonly agents: AgentQuery,
    private readonly service: AgentService,
  ) {}

  @Get()
  teams(@CurrentActor() actor: Actor): AgentTeamListView {
    return this.agents.teams(actor);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<AgentTeamSavedView> {
    const made = await this.service.createTeam(actor, CreateAgentTeamInput.from(body));
    return new AgentTeamSavedView(made.map((agent) => agent.view()));
  }
}
