import { Injectable } from '@nestjs/common';
import { type Actor, BaseService, Forbidden, SystemActor } from '../../platform';
import { AgentRepository } from '../agent/agent.repository';
import { Task } from '../task/task';
import { TaskRepository } from '../task/task.repository';
import { ChatRepository } from './chat.repository';
import { ChatRequest } from './chat-request.policy';
import { ChatRoute } from './chat-route.policy';
import { ChatUpdates } from './chat-update.policy';

// 배정의 뒤 (2차 1-5 · 기획서 결정 2026-11-14): 배정 일이 끝나면 답을 읽어 맡기거나 묻고(routed),
// 아무 러너도 1분 넘게 빌려 가지 않으면 그 일을 취소하고 서버가 묻는다(overdue). 시작은 ChatService.start.
// 잠그는 순서는 ChatService와 같다: 대화 → 작업
@Injectable()
export class ChatRouteService extends BaseService {
  /** 한 번에 넘김을 보는 배정 일 수 */
  private static readonly OVERDUE_BATCH = 50;

  /**
   * 작업 하나가 바뀌었다. 끝난 배정 일이면 그 답으로 맡기거나 묻는다 (실패면 서버의 질문).
   * 두 번 불려도 같다 (이미 맡았거나 그 배정 일로 이미 물었으면 그대로). 더 새 배정 일이 돌면 그 답을 기다린다
   */
  async routed(actor: Actor, spaceId: string, taskId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const now = new Date();
    await this.transaction(async (tx) => {
      const tasks = new TaskRepository(tx);
      const task = await tasks.findIn(spaceId, taskId);
      const chatId = ChatRequest.routedChat(task?.requestId ?? null);
      if (!task?.ended || chatId === null) return;
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, chatId);
      if (chat.agentId !== null || (await chats.hasUpdate(task.id, ChatUpdates.QUESTION))) return;
      const newer = await tasks.lockOpenRequests(spaceId, ChatRequest.route(chatId));
      if (newer.length > 0) return;
      const candidates = ChatRoute.candidates(await new AgentRepository(tx).all(spaceId));
      const decision = ChatRoute.parse(task.answer, candidates);
      if (decision.kind === 'agent') {
        const { agent, reason, deliver } = decision;
        const turn = chat.assign(agent, now, reason, deliver, task.id);
        await chats.save(chat);
        await tasks.insertOnce(turn);
        return;
      }
      chat.ask(decision.question, decision.choices, now, task.id);
      await chats.save(chat);
    });
  }

  /** 1분 넘게 아무도 빌려 가지 않은 배정 일을 취소하고 서버가 묻는다 (러너가 없거나 바쁘다). 본 일의 수를 돌려준다 */
  async overdue(actor: Actor, now = new Date()): Promise<number> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const before = new Date(now.getTime() - ChatRoute.WAIT_MS);
    const stale = await this.transaction((tx) =>
      new TaskRepository(tx).staleQueued(Task.ROUTE, before, ChatRouteService.OVERDUE_BATCH),
    );
    for (const route of stale) {
      const chatId = ChatRequest.routedChat(route.requestId);
      if (chatId === null) continue;
      await this.transaction(async (tx) => {
        const chats = new ChatRepository(tx);
        const tasks = new TaskRepository(tx);
        const chat = await chats.lock(route.spaceId, chatId);
        const open = await tasks.lockOpenRequests(route.spaceId, ChatRequest.route(chatId));
        const still = open.find((t) => t.id === route.id);
        if (!still) return;
        still.cancel(now);
        await tasks.save(still);
        if (chat.agentId !== null) return;
        const candidates = ChatRoute.candidates(await new AgentRepository(tx).all(route.spaceId));
        chat.ask(ChatRoute.QUESTION, candidates, now, route.id);
        await chats.save(chat);
      });
    }
    return stale.length;
  }
}
