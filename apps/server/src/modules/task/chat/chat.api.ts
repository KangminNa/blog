import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { type Actor, CurrentActor, VersionInput } from '../../platform';
import { ChatIdInput, CreateChatInput, SendChatInput } from './chat.input';
import { ChatQuery } from './chat.query';
import { ChatService } from './chat.service';
import type { ChatDetailView, ChatListView, ChatView } from './chat.view';

// 대화 (콘솔 운영 › 대화). 모두 관리자만 (Service · Query 첫 줄에서 확인).
// 답을 멈추려면 회차 작업을 취소하고(api/tasks/:id/cancel), 결재는 api/approvals/:id/decide로 정한다.
@Controller('api/chats')
export class ChatController {
  constructor(
    private readonly query: ChatQuery,
    private readonly service: ChatService,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor): Promise<ChatListView> {
    return this.query.list(actor);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id') id: string): Promise<ChatDetailView> {
    return this.query.get(actor, ChatIdInput.from(id));
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() body: unknown): Promise<ChatView> {
    return (await this.service.create(actor, CreateChatInput.from(body))).view();
  }

  @Post(':id/messages')
  async send(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ChatView> {
    return (await this.service.send(actor, SendChatInput.from(id, body))).view();
  }

  /** 멈추기 (2차 2단계): 도는 일 · 기다리는 결재 · 결과 카드를 모두 취소한다 */
  @Post(':id/stop')
  @HttpCode(200)
  async stop(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ChatView> {
    return (await this.service.stop(actor, VersionInput.from(id, body))).view();
  }
}
