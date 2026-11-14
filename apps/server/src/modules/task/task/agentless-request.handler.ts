import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { AgentlessRequestInput } from './agentless.input';
import { AgentlessService } from './agentless.service';

// 다른 모듈이 task.agentless.requested 이벤트로 에이전트 없는 일을 요청한다 (세션 노트). requestId로 작업은 하나만 생긴다
@Injectable()
export class AgentlessRequestHandler extends BaseHandler {
  static readonly TOPIC = 'task.agentless.requested';

  constructor(private readonly agentless: AgentlessService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    await this.agentless.request(
      new SystemActor(),
      event.spaceId,
      AgentlessRequestInput.from(event.data),
    );
  }
}
