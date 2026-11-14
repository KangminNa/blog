import { Injectable } from '@nestjs/common';
import { Actor, BaseService, Forbidden } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { TaskRepository } from '../task/task.repository';
import { Chat } from './chat';
import type { AskAgentInput, CreateChatInput, SendChatInput } from './chat.input';
import { ChatRepository } from './chat.repository';

// 대화 쓰기: 관리자(콘솔), 그리고 "에이전트에게 맡기기" 권한을 받은 기기(MCP ask_agent, 자기가 연 대화만). 대화와 회차 작업은 함께 바뀌어야 해서 같은 트랜잭션에서 쓴다 (목표 실행과 같은 이유).
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

  /**
   * MCP ask_agent: "에이전트에게 맡기기"(delegate) 권한을 받은 기기(내 컴퓨터의 AI 도구)가 서버 팀에 메시지를 보낸다.
   * chatId가 없으면 상대(이름이나 id, 관리자 바로 아래)와 새 대화를 열고, 있으면 그 기기가 연 대화에 이어 보낸다.
   * 같은 requestId는 한 번만. 기기의 메시지라고 남긴다 (read_url의 기준에 넣지 않게). 결재는 이 길로 하지 못한다
   */
  async ask(actor: Actor, req: AskAgentInput): Promise<Chat> {
    actor.assertCan(Actor.DELEGATE);
    if (actor.kind !== 'device' || !actor.id) throw new Forbidden(Actor.DELEGATE);
    const deviceId = actor.id;
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const agents = new AgentRepository(tx);
      if (req.chatId === null) {
        const before = await chats.findByRequest(spaceId, req.requestId);
        before?.assertSender(deviceId);
        if (before) return before;
        const agent = Chat.partnerOf(await agents.all(spaceId), req.agent);
        const chat = Chat.open(spaceId, req.requestId, agent, req.message, now, deviceId);
        const task = chat.send(agent, req.requestId, req.message, [], now, deviceId);
        await chats.save(chat);
        await new TaskRepository(tx).insertOnce(task);
        return chat;
      }
      const chat = await chats.lock(spaceId, req.chatId);
      chat.assertSender(deviceId);
      const previous = await chats.previousTurns(chat, spaceId);
      if (chat.alreadySent(previous, req.requestId)) return chat;
      const agent = await agents.load(spaceId, chat.agentId);
      const task = chat.send(agent, req.requestId, req.message, previous, now, deviceId);
      await chats.save(chat);
      await new TaskRepository(tx).insertOnce(task);
      return chat;
    });
  }
}
