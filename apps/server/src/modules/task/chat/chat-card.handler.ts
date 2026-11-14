import { Injectable } from '@nestjs/common';
import { BaseHandler, type DomainEvent, SystemActor } from '../../platform';
import { Approval } from '../approval/approval';
import { ChatService } from './chat.service';

// 결과 카드를 수정 요청 · 반려하면 그 대화의 도는 일을 멈추고, 수정 요청이면 메모를 다음 회차로 보낸다 (2차 2단계)
@Injectable()
export class ChatCardHandler extends BaseHandler {
  static readonly TOPICS: readonly string[] = [
    'task.approval.revision_requested',
    'task.approval.rejected',
  ];

  constructor(private readonly chats: ChatService) {
    super();
  }

  async handle(event: DomainEvent): Promise<void> {
    if (event.data.action !== Approval.CARD || typeof event.data.approvalId !== 'string') return;
    await this.chats.closeByCard(new SystemActor(), event.spaceId, event.data.approvalId);
  }
}
