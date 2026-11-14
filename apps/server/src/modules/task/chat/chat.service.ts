import { Injectable } from '@nestjs/common';
import {
  Actor,
  BaseService,
  Database,
  Forbidden,
  Idempotency,
  RuleViolation,
  type Sql,
  SystemActor,
  type VersionInput,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { AgentRepository } from '../agent/agent.repository';
import { AiLoginRepository } from '../ai/ai-login.repository';
import { Approval } from '../approval/approval';
import { ApprovalRepository } from '../approval/approval.repository';
import type { PromptTemplates } from '../skill/prompt-templates';
import { SkillQuery } from '../skill/skill.query';
import { TaskRepository } from '../task/task.repository';
import { Chat } from './chat';
import type { AskAgentInput, CreateChatInput, SendChatInput } from './chat.input';
import { ChatRepository } from './chat.repository';
import { ChatHistory } from './chat-history.policy';
import { ChatProject } from './chat-project.policy';
import { ChatRequest } from './chat-request.policy';
import { ChatResult } from './chat-result.policy';
import { ChatRoute } from './chat-route.policy';
import { ChatUpdates } from './chat-update.policy';

// 대화 쓰기: 관리자(콘솔), 그리고 "에이전트에게 맡기기" 권한을 받은 기기(MCP ask_agent, 자기가 연 대화만). 대화와 회차 작업은 함께 바뀌어야 해서 같은 트랜잭션에서 쓴다 (목표 실행과 같은 이유).
// 대화 줄을 잠그고 앞 회차를 읽어서, 동시에 두 메시지를 보내도 회차는 하나만 생긴다 (둘째는 그 회차에 덧붙인 말이 된다, 2차 1-1).
// 상대(에이전트)는 잠그지 않는다: 바뀐 상대(팀원으로 옮김 · 멈춤 · 삭제)는 다음 메시지에서 걸린다.
// 2차 1-5: 새 대화는 상대 없이 열고 맡을 에이전트를 정한다 (start: 바로 · 배정 일 · 묻기). 배정 일의 답과 1분 넘김은 ChatRouteService
@Injectable()
export class ChatService extends BaseService {
  private static readonly APPEND = 'chat_append';

  constructor(
    db: Database,
    private readonly skills: SkillQuery,
  ) {
    super(db);
  }

  /** 새 대화와 첫 메시지 (2차 1-5): 상대를 정했으면 그에게, 아니면 배정. 같은 requestId는 처음 만든 대화 */
  async create(actor: Actor, req: CreateChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const before = await chats.findByRequest(spaceId, req.requestId);
      if (before) return before;
      const agents = new AgentRepository(tx);
      const chosen = req.agentId === null ? null : await agents.load(spaceId, req.agentId);
      const chat = Chat.open(
        spaceId,
        req.requestId,
        req.message,
        now,
        null,
        req.goal,
        ChatProject.of(req.project),
        ChatResult.deliverOf(req.deliver),
      );
      await this.start(tx, chat, await agents.all(spaceId), chosen, prompts, now);
      return chat;
    });
  }

  /**
   * 메시지 하나 = 다음 회차 작업 (끝나지 않은 회차가 있으면 덧붙인 말, 맡기 전이면 질문의 답).
   * 같은 requestId를 다시 보내면 그대로 (본 version이 낡았어도)
   */
  async send(actor: Actor, req: SendChatInput): Promise<Chat> {
    actor.assertOwner();
    const spaceId = actor.requireSpace();
    const now = new Date();
    const prompts = await this.skills.prompts(actor, spaceId);
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const chat = await chats.lock(spaceId, req.id);
      const reply = { requestId: req.requestId, message: req.message, choice: req.choice };
      if (chat.agentId === null)
        return this.answer(tx, actor, chat, reply, prompts, now, null, req.version);
      const agent = await new AgentRepository(tx).load(spaceId, chat.agentId);
      return this.talk(tx, actor, chat, agent, req.requestId, req.message, now, null, req.version);
    });
  }

  /**
   * MCP ask_agent: "에이전트에게 맡기기"(delegate) 권한을 받은 기기(내 컴퓨터의 AI 도구)가 서버 팀에 메시지를 보낸다.
   * chatId가 없으면 새 대화(상대: 이름이나 id, 생략하면 배정 · 목표 · 프로젝트와 함께), 있으면 그 기기가 연 대화에 이어 보낸다
   * (맡기 전이면 질문의 답). 같은 requestId는 한 번만. 기기의 메시지라고 남긴다 (read_url의 기준에 넣지 않게). 결재는 이 길로 하지 못한다
   */
  async ask(actor: Actor, req: AskAgentInput): Promise<Chat> {
    actor.assertCan(Actor.DELEGATE);
    if (actor.kind !== 'device' || !actor.id) throw new Forbidden(Actor.DELEGATE);
    const deviceId = actor.id;
    const spaceId = actor.requireSpace();
    const prompts = await this.skills.prompts(actor, spaceId);
    const now = new Date();
    return this.transaction(async (tx) => {
      const chats = new ChatRepository(tx);
      const agents = new AgentRepository(tx);
      if (req.chatId === null) {
        const before = await chats.findByRequest(spaceId, req.requestId);
        before?.assertSender(deviceId);
        if (before) return before;
        const org = await agents.all(spaceId);
        const chosen = req.agent === null ? null : ChatRoute.wanted(org, req.agent);
        const chat = Chat.open(
          spaceId,
          req.requestId,
          req.message,
          now,
          deviceId,
          req.goal,
          ChatProject.of(req.project),
          ChatResult.deliverOf(req.deliver),
        );
        await this.start(tx, chat, org, chosen, prompts, now);
        return chat;
      }
      const chat = await chats.lock(spaceId, req.chatId);
      chat.assertSender(deviceId);
      const reply = { requestId: req.requestId, message: req.message, choice: req.choice };
      if (chat.agentId === null) return this.answer(tx, actor, chat, reply, prompts, now, deviceId);
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
      const agent = await new AgentRepository(tx).load(spaceId, chat.partnerId);
      await this.talk(tx, actor, chat, agent, `card:${card.id}`, card.note, now, null);
    });
  }

  /** 대화의 끝나지 않은 일(배정 일 포함) · 기다리는 결재 · 결과 카드를 취소한다 (잠그는 순서: 대화 → 작업(위 → 아래) → 결재) */
  private async cancelOpen(tx: Sql, spaceId: string, chatId: string, now: Date): Promise<void> {
    const tasks = new TaskRepository(tx);
    const open = [
      ...(await tasks.lockOpenRequests(spaceId, ChatRequest.route(chatId))),
      ...(await tasks.lockOpenInChat(spaceId, chatId)),
    ];
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
   * 맡을 에이전트를 정한다 (2차 1-5): 정해 준 상대나 후보가 하나면 바로 맡기고, 여럿이면 배정 일(AI가 한 번 고른다).
   * 배정 일을 돌릴 로그인이 없으면 바로 묻는다. answers: 맡기 전에 글로 한 답 (배정 일이 함께 본다).
   * again: 이미 물었던 대화에 다시 (로그인이 없으면 같은 질문을 또 하지 않는다)
   */
  private async start(
    tx: Sql,
    chat: Chat,
    agents: readonly Agent[],
    chosen: Agent | null,
    prompts: PromptTemplates,
    now: Date,
    answers: readonly string[] = [],
    again = false,
  ): Promise<void> {
    const chats = new ChatRepository(tx);
    const tasks = new TaskRepository(tx);
    const candidates = ChatRoute.candidates(agents);
    const only = chosen ?? (candidates.length === 1 ? candidates[0] : null);
    if (only) {
      const turn = chat.assign(only, now);
      await chats.save(chat);
      await tasks.insertOnce(turn);
      return;
    }
    if (candidates.length === 0) throw new RuleViolation(ChatRoute.NONE);
    const usable = await new AiLoginRepository(tx).usableTools(chat.spaceId, now);
    const tool = usable.includes('claude') ? 'claude' : (usable[0] ?? null);
    if (tool === null) {
      if (!again) chat.ask(ChatRoute.QUESTION, candidates, now);
      await chats.save(chat);
      return;
    }
    const instruction = prompts.fill('chat-route', {
      message: [chat.pending ?? '', ...answers].join('\n\n'),
      agents: ChatRoute.listOf(candidates),
    });
    const task = chat.route(tool, instruction, now);
    await chats.save(chat);
    await tasks.insertOnce(task);
  }

  /**
   * 맡기 전의 대화에 한 말 (질문의 답): 고른 에이전트(choice)나 고를 것을 가리키는 말(번호 · 이름)이면 맡기고,
   * 아니면 답으로 남기고 다시 배정한다 (도는 배정 일은 취소). 같은 requestId는 한 번만
   */
  private async answer(
    tx: Sql,
    actor: Actor,
    chat: Chat,
    reply: { requestId: string; message: string; choice: string | null },
    prompts: PromptTemplates,
    now: Date,
    deviceId: string | null,
    version?: number,
  ): Promise<Chat> {
    const once = new Idempotency(tx, actor.id ?? chat.spaceId, reply.requestId, ChatService.APPEND);
    if (await once.previous()) return chat;
    if (version !== undefined) chat.assertVersion(version);
    const chats = new ChatRepository(tx);
    const tasks = new TaskRepository(tx);
    const agents = await new AgentRepository(tx).all(chat.spaceId);
    const candidates = ChatRoute.candidates(agents);
    // 질문이 준 순서대로 (번호가 그 순서를 가리킨다). 그사이 후보에서 빠진 에이전트는 뺀다
    const offered = (await chats.lastChoices(chat.id))
      .map((id) => candidates.find((a) => a.id === id))
      .filter((a): a is Agent => a !== undefined);
    const picked =
      reply.choice === null
        ? ChatRoute.chosen(reply.message, offered)
        : candidates.find((a) => a.id === reply.choice);
    if (picked === undefined) throw new RuleViolation('고를 수 없는 에이전트예요');
    for (const open of await tasks.lockOpenRequests(chat.spaceId, ChatRequest.route(chat.id))) {
      open.cancel(now);
      await tasks.save(open);
    }
    if (picked) {
      await this.start(tx, chat, agents, picked, prompts, now);
    } else {
      const answers = await chats.answersBefore(chat.id);
      chat.answer(reply.message, answers.length, now);
      await this.start(tx, chat, agents, null, prompts, now, [...answers, reply.message], true);
    }
    await once.remember({ chatId: chat.id, deviceId });
    return chat;
  }

  /**
   * 맡은 대화에 말한다: 앞 회차가 끝났으면 다음 회차, 아니면 그 회차에 덧붙인 말 (소식 + 상대가 짧게 답하는 작업).
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
