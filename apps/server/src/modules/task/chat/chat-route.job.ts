import { Injectable } from '@nestjs/common';
import { BaseJob, SystemActor } from '../../platform';
import { ChatRouteService } from './chat-route.service';

// 1분 넘게 아무도 빌려 가지 않은 배정 일을 서버의 질문으로 바꾼다 (2차 1-5). 러너가 하나도 없어도 관리자가 기다리지 않게
@Injectable()
export class ChatRouteJob extends BaseJob {
  static readonly EVERY_MS = 15_000;
  readonly name = 'task.chat-routes';

  constructor(private readonly routes: ChatRouteService) {
    super();
  }

  async run(): Promise<void> {
    await this.routes.overdue(new SystemActor());
  }
}
