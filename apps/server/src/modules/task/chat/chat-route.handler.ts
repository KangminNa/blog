import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { ChatRouteService } from './chat-route.service';

// 작업이 끝나면 대화의 배정 일인지 보고 그 답으로 맡기거나 묻는다 (2차 1-5). 배정 일인지는 서비스가 본다
@Injectable()
export class ChatRouteHandler extends BaseHandler {
  private static readonly ENDED: readonly string[] = ['done', 'failed'];

  constructor(private readonly routes: ChatRouteService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    const taskId = event.data.taskId;
    if (typeof taskId !== 'string' || !ChatRouteHandler.ENDED.includes(String(event.data.status)))
      return;
    await this.routes.routed(new SystemActor(), event.spaceId, taskId);
  }
}
