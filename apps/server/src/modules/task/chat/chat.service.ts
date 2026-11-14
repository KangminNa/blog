import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseService,
  Forbidden,
  Idempotency,
  type Sql,
  SystemActor,
  type VersionInput,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import { TaskRepository } from '../task/task.repository';
import { Chat } from './chat';
import type { AskAgentInput, CreateChatInput, SendChatInput } from './chat.input';
import { ChatRepository } from './chat.repository';
import { ChatHistory } from './chat-history.policy';
import { ChatProject } from './chat-project.policy';
import { ChatResult } from './chat-result.policy';
import { ChatUpdates } from './chat-update.policy';

// 대화 쓰기: 관리자(콘솔), 그리고 "에이전트에게 맡기기" 권한을 받은 기기(MCP ask_agent, 자기가 연 대화만). 대화와 회차 작업은 함께 바뀌어야 해서 같은 트랜잭션에서 쓴다 (목표 실행과 같은 이유).
// 대화 줄을 잠그고 앞 회차를 읽어서, 동시에 두 메시지를 보내도 회차는 하나만 생긴다 (둘째는 그 회차에 덧붙인 말이 된다, 2차 1-1).
// 상대(에이전트)는 잠그지 않는다: 바뀐 상대(팀원으로 옮김 · 멈춤 · 삭제)는 다음 메시지에서 걸린다.
@Injectable()
export class ChatService extends BaseService {
  private static readonly APPEND = 'chat_append';

  /** 새 대화와 첫 메시지 (상대를 비우면 기본 대표, 목표 · 프로젝트와 함께). 같은 requestId는 처음 만든 대화 */
  async create(actor: Actor, req: CreateChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const before = await chats.findByRequest(spaceId, req.requestId);
      if (before) return before;
      const agents = new AgentRepository(tx);
      const agent =
        req.agentId === null
          ? Chat.partnerOf(await agents.all(spaceId), null)
          : await agents.load(spaceId, req.agentId);
      const project = ChatProject.of(req.project);
      const chat = Chat.open(
        spaceId,
        req.requestId,
        agent,
        req.message,
        now,
        null,
        req.goal,
        project,
        ChatResult.deliverOf(req.deliver),
      );
      const task = chat.send(agent, req.requestId, req.message, [], now);
      await chats.save(chat);
      await new TaskRepository(tx).insertOnce(task);
      return chat;
    });
  }

  /** 메시지 하나 = 다음 회차 작업 (끝나지 않은 회차가 있으면 덧붙인 말). 같은 requestId를 다시 보내면 그대로 (본 version이 낡았어도) */
  async send(actor: Actor, req: SendChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, req.id);
      const agent = await new AgentRepository(tx).load(spaceId, chat.agentId);
      return this.talk(tx, actor, chat, agent, req.requestId, req.message, now, null, req.version);
    });
  }

  /**
   * MCP ask_agent: "에이전트에게 맡기기"(delegate) 권한을 받은 기기(내 컴퓨터의 AI 도구)가 서버 팀에 메시지를 보낸다.
   * chatId가 없으면 상대(이름이나 id, 생략하면 기본 대표)와 새 대화를 열고(목표 · 프로젝트와 함께), 있으면 그 기기가 연 대화에 이어 보낸다.
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
        const project = ChatProject.of(req.project);
        const chat = Chat.open(
          spaceId,
          req.requestId,
          agent,
          req.message,
          now,
          deviceId,
          req.goal,
          project,
          ChatResult.deliverOf(req.deliver),
        );
        const task = chat.send(agent, req.requestId, req.message, [], now, deviceId);
        await chats.save(chat);
        await new TaskRepository(tx).insertOnce(task);
        return chat;
      }
      const chat = await chats.lock(spaceId, req.chatId);
      chat.assertSender(deviceId);
      const agent = await agents.load(spaceId, chat.agentId);
      return this.talk(tx, actor, chat, agent, req.requestId, req.message, now, deviceId);
    });
  }

  /** 관리자가 대화를 멈춘다 (2차 2단계): 도는 일(회차 · 덧붙인 말의 답 · 검토와 그 아래)과 기다리는 결재 · 결과 카드를 모두 취소 */
  async stop(actor: Actor, req: VersionInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    return this.transaction(async (tx) => {
      const chat = await new ChatRepository(tx).lock(spaceId, req.id);
      chat.assertVersion(req.version);
      await this.cancelOpen(tx, spaceId, chat.id, now);
      return chat;
    });
  }

  /**
   * 결과 카드를 수정 요청 · 반려한 뒤 (ChatCardHandler): 도는 일을 멈추고, 수정 요청이면 관리자의 메모를 다음 회차로 보낸다.
   * 두 번 불려도 같다 (다음 회차는 카드의 id로 한 번만)
   */
  async closeByCard(actor: Actor, spaceId: string, cardId: string): Promise<void> {
    if (!(actor instanceof SystemActor)) throw new Forbidden('system');
    const now = new Date();
    await this.transaction(async (tx) => {
      const card = await new ApprovalRepository(tx).findIn(spaceId, cardId);
      if (!card?.isCard) return;
      const revise = card.status === Approval.REVISION_REQUESTED;
      if (!revise && card.status !== Approval.REJECTED) return;
      const chat = await new ChatRepository(tx).lock(spaceId, card.targetId);
      await this.cancelOpen(tx, spaceId, chat.id, now);
      if (!revise || !card.note) return;
      const agent = await new AgentRepository(tx).load(spaceId, chat.agentId);
      await this.talk(tx, actor, chat, agent, `card:${card.id}`, card.note, now, null);
    });
  }

  /** 대화의 끝나지 않은 일 · 기다리는 결재 · 결과 카드를 취소한다 (잠그는 순서: 대화 → 작업(위 → 아래) → 결재) */
  private async cancelOpen(tx: Sql, spaceId: string, chatId: string, now: Date): Promise<void> {
    const tasks = new TaskRepository(tx);
    const open = await tasks.lockOpenInChat(spaceId, chatId);
    for (const task of open) {
      task.cancel(now);
      await tasks.save(task);
    }
    const approvals = new ApprovalRepository(tx);
    const pending: (Approval | null)[] = [];
    for (const task of open) pending.push(await approvals.lockPending(task.id));
    pending.push(await approvals.lockOpenCard(chatId));
    for (const approval of pending) {
      if (!approval) continue;
      approval.cancel();
      await approvals.save(approval);
    }
  }

  /**
   * 열린 대화에 말한다: 앞 회차가 끝났으면 다음 회차, 아니면 그 회차에 덧붙인 말 (소식 + 대표가 짧게 답하는 작업).
   * 같은 requestId는 한 번만 (회차는 회차의 requestId로, 덧붙인 말은 Idempotency로). version은 관리자가 본 대화의 판
   */
  private async talk(
    tx: Sql,
    actor: Actor,
    chat: Chat,
    agent: Agent,
    requestId: string,
    message: string,
    now: Date,
    deviceId: string | null,
    version?: number,
  ): Promise<Chat> {
    const chats = new ChatRepository(tx);
    const previous = await chats.previousTurns(chat, chat.spaceId);
    if (chat.alreadySent(previous, requestId)) return chat;
    const once = new Idempotency(tx, actor.id ?? chat.spaceId, requestId, ChatService.APPEND);
    if (await once.previous()) return chat;
    if (version !== undefined) chat.assertVersion(version);
    const current = previous.at(-1);
    const tasks = new TaskRepository(tx);
    if (current && ChatHistory.waiting(current)) {
      const appended = await chats.countUpdates(current.id, [ChatUpdates.APPENDED]);
      const reply = chat.appendTo(
        current,
        agent,
        requestId,
        message,
        previous,
        appended,
        now,
        deviceId,
      );
      await chats.save(chat);
      if (reply) await tasks.insertOnce(reply);
      await once.remember({ chatId: chat.id });
      return chat;
    }
    const task = chat.send(agent, requestId, message, previous, now, deviceId);
    await chats.save(chat);
    await tasks.insertOnce(task);
    return chat;
  }
}
