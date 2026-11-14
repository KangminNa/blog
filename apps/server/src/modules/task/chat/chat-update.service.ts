import { Injectable } from '@nestjs/common';
import {
  Actor,
  AgentActor,
  BaseService,
  Forbidden,
  RuleViolation,
  SystemActor,
} from '../../platform';
import { ChatRepository } from './chat.repository';
import type { PostUpdateInput } from './chat-update.input';
import { ChatUpdates } from './chat-update.policy';

// 대화의 소식 쓰기 (task.chat_updates, 2차 1-1). 소식은 대화 엔티티를 거쳐 쌓이고(Chat.note) 변경 신호로 agent_updates를 깨운다.
//   일꾼: 대화 안의 작업이 끝나면(task.task.changed) 팀원 끝남 · 실패 · 최종 답 · 덧붙인 말의 답 (ChatUpdateHandler)
//   작업 토큰: 대화에서 맡은 일(그 아래 하위 작업 포함)의 에이전트가 MCP post_update로 중간 보고 · 정한 것 · 가정
// 대화 줄은 잠그지 않는다: 소식은 추가만이고, 한도는 작업마다 센다 (동시에 남기면 하나 더 들어갈 수 있다).
@Injectable()
export class ChatUpdateService extends BaseService {
  /** 끝난 작업의 소식. 대화의 일이 아니거나, 소식이 아니거나(취소), 이미 남겼으면 그대로. 두 번 불려도 같다 */
  async noteSettled(actor: Actor, taskId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const now = new Date();
    await this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const place = await chats.placeOf(taskId);
      const said = place ? ChatUpdates.settled(place) : null;
      if (!place || !said || (await chats.hasUpdate(taskId, said.kind))) return;
      const chat = await chats.load(place.space_id, place.chat_id);
      chat.settled(said.kind, said.text, taskId, place.agent_id, now);
      await chats.save(chat);
    });
  }

  /** MCP post_update: 소식 하나를 남기고 그 번호(n)를 돌려준다. 대화에서 맡은 일이 아니면 RuleViolation */
  async post(actor: Actor, req: PostUpdateInput): Promise<number> {
    actor.assertCan(Actor.AGENT);
    if (!(actor instanceof AgentActor) || !actor.spaceId || !actor.id)
      throw new Forbidden(Actor.AGENT);
    const { spaceId, id: agentId, taskId } = actor;
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const place = await chats.placeOf(taskId);
      if (!place) throw new RuleViolation('대화에서 맡은 일이 아니에요');
      const chat = await chats.load(spaceId, place.chat_id);
      const posted = await chats.countUpdates(taskId, ChatUpdates.POSTED);
      chat.post(req.kind, req.text, taskId, agentId, posted, now);
      await chats.save(chat);
      return chats.numberOf(chat.addedUpdates[0]?.id ?? '');
    });
  }
}
