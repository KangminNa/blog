import { Body, Controller, Param, Put } from '@nestjs/common';
import { type Actor, BaseResponse, CurrentActor } from '../../platform';
import { AgentHeartbeatView } from '../agent/agent.view';
import type { Heartbeat } from './heartbeat';
import { HeartbeatInput } from './heartbeat.input';
import { HeartbeatService } from './heartbeat.service';

/** 정한 하트비트. 에이전트 목록의 heartbeat와 같은 모양이고, 화면은 이 version으로 다음 변경을 보낸다 */
export class HeartbeatResponse extends BaseResponse {
  private constructor(private readonly heartbeat: Heartbeat) {
    super();
  }

  static of(heartbeat: Heartbeat): HeartbeatResponse {
    return new HeartbeatResponse(heartbeat);
  }

  toJSON(): object {
    const h = this.heartbeat;
    return new AgentHeartbeatView(
      h.enabled,
      h.mode,
      h.atMinute,
      h.weekdays,
      h.everyHours,
      h.timeZone,
      h.instruction,
      h.goalId,
      h.nextRunAt,
      h.lastRunAt,
      h.version,
    ).toJSON();
  }
}

// 에이전트의 하트비트. 주인만 (Service 첫 줄에서 확인). 읽기는 에이전트 목록에 함께 실린다.
@Controller('api/agents')
export class HeartbeatController {
  constructor(private readonly service: HeartbeatService) {}

  @Put(':id/heartbeat')
  async put(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<HeartbeatResponse> {
    return HeartbeatResponse.of(await this.service.configure(actor, HeartbeatInput.from(id, body)));
  }
}
