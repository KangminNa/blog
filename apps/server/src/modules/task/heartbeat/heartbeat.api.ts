import { Body, Controller, Param, Put } from '@nestjs/common';
import { type Actor, CurrentActor } from '../../platform';
import type { AgentHeartbeatView } from '../agent/agent.view';
import { HeartbeatInput } from './heartbeat.input';
import { HeartbeatService } from './heartbeat.service';

// 에이전트의 하트비트. 주인만 (Service 첫 줄에서 확인). 읽기는 에이전트 목록에 함께 실린다.
// 정한 하트비트는 에이전트 목록의 heartbeat와 같은 모양이고, 화면은 그 version으로 다음 변경을 보낸다.
@Controller('api/agents')
export class HeartbeatController {
  constructor(private readonly service: HeartbeatService) {}

  @Put(':id/heartbeat')
  async put(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AgentHeartbeatView> {
    return (await this.service.configure(actor, HeartbeatInput.from(id, body))).view();
  }
}
