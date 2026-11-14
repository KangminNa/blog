import { Injectable } from '@nestjs/common';
import { type Actor, BaseService } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { TaskRepository } from '../task/task.repository';
import { Chat } from './chat';
import type { CreateChatInput, SendChatInput } from './chat.input';
import { ChatRepository } from './chat.repository';

// 대화 쓰기 (관리자만). 대화와 회차 작업은 함께 바뀌어야 해서 같은 트랜잭션에서 쓴다 (목표 실행과 같은 이유).
// 대화 줄을 잠그고 앞 회차를 읽어서, 동시에 두 메시지를 보내도 하나만 들어간다 (둘째는 답을 기다리는 중이라 409).
// 상대(에이전트)는 잠그지 않는다: 바뀐 상대(팀원으로 옮김 · 멈춤 · 삭제)는 다음 메시지에서 걸린다.
@Injectable()
export class ChatService extends BaseService {
  /** 새 대화와 첫 메시지. 같은 requestId는 처음 만든 대화 */
  async create(actor: Actor, req: CreateChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const before = await chats.findByRequest(spaceId, req.requestId);
      if (before) return before;
      const agent = await new AgentRepository(tx).load(spaceId, req.agentId);
      const chat = Chat.open(spaceId, req.requestId, agent, req.message, now);
      const task = chat.send(agent, req.requestId, req.message, [], now);
      await chats.save(chat);
      await new TaskRepository(tx).insertOnce(task);
      return chat;
    });
  }

  /** 메시지 하나 = 다음 회차 작업. 같은 requestId를 다시 보내면 그대로 (본 version이 낡았어도) */
  async send(actor: Actor, req: SendChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, req.id);
      const previous = await chats.previousTurns(chat, spaceId);
      if (chat.alreadySent(previous, req.requestId)) return chat;
      chat.assertVersion(req.version);
      const agent = await new AgentRepository(tx).load(spaceId, chat.agentId);
      const task = chat.send(agent, req.requestId, req.message, previous, now);
      await chats.save(chat);
      await new TaskRepository(tx).insertOnce(task);
      return chat;
    });
  }
}
