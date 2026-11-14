import {
  BaseEntity,
  Conflict,
  DomainEvent,
  NotFound,
  RuleViolation,
  TableEntity,
} from '../../platform';
import type { Agent } from '../agent/agent';
import { Task } from '../task/task';
import type { ChatNew, ChatRow, ChatUpdateNew } from '../task.tables';
import { ChatView } from './chat.view';
import { ChatHistory, type ChatTurnRow } from './chat-history.policy';
import { ChatRequest } from './chat-request.policy';
import { ChatRoute } from './chat-route.policy';
import { ChatUpdates } from './chat-update.policy';

// 대화 하나 (task.chats, 기획서 결정 2026-11-14). 관리자와 바로 아래 에이전트 하나가 채팅처럼 주고받는다.
// 서버 본체에는 AI가 없어서 메시지 하나 = 상대에게 맡기는 작업 하나다 (회차, request_id chat:<대화>:<회차>).
// 이 줄은 머리(상대 · 제목 · 회차 수)만 든다: 메시지는 작업의 지시, 답은 작업의 결과라 두 벌로 두지 않는다.
// 앞 대화는 회차 작업의 payload.chat.history에 자료로 싣는다. read_url의 기준(주인의 글)은 그대로 이번 메시지뿐이다.
// 2차 1-1: 회차가 끝나지 않았을 때 보낸 말은 덧붙인 말이 된다 (appendTo): 소식 한 줄 + 상대가 짧게 답하는 작업 하나.
// 2차 1-5: 상대 없이 열고(첫 메시지는 pending) 맡을 에이전트를 정한다 (ChatRoute): 바로 · 배정 일(AI) · 관리자에게 묻기.
// 대화의 소식(task.chat_updates, 추가만)은 이 엔티티를 거쳐 쌓인다 (ChatRepository.saveParts)
export class Chat extends TableEntity<ChatRow, ChatNew> {
  /** 화면이 대화 목록 · 대화를 다시 읽는다 (받는 모듈은 없다) */
  static readonly CHANGED = 'task.chat.changed';
  /** 맡을 에이전트를 물었다 · 맡았다 · 회차의 답이 왔다: 알림 (TaskNotices, 2차 1-5) */
  static readonly ASKED = 'task.chat.asked';
  static readonly ROUTED = 'task.chat.routed';
  static readonly ANSWERED = 'task.chat.answered';
  static readonly TITLE_MAX = 80;
  static readonly MESSAGE_MAX = 8000;
  static readonly GOAL_MAX = 300;
  /** 배정 일은 쌓인 일보다 먼저 (관리자가 답을 기다린다) */
  private static readonly ROUTE_PRIORITY = 900;
  /** 회차 작업의 제목 (작업 메뉴에서 대화의 일인지 알아보게) */
  private static readonly TASK_TITLE = 60;
  /** 이번에 쌓을 소식 (saveParts가 넣는다) */
  private added: ChatUpdateNew[] = [];

  /**
   * 새 대화 (2차 1-5): 상대 없이 열고 첫 메시지를 pending에 둔다. 맡을 에이전트는 assign으로 (바로 · 배정 일 · 질문의 답).
   * deviceId: 기기(MCP ask_agent)가 연 대화면 그 기기. goal: 목표 한 줄, project: 맞춘 git 주소 (ChatProject),
   * deliver: 받을 것 (ChatResult.deliverOf). 열 때만 정한다 (배정 일이 받을 것을 고르면 비어 있을 때만 채운다)
   */
  static open(
    spaceId: string,
    requestId: string,
    message: string,
    now: Date,
    deviceId: string | null = null,
    goal: string | null = null,
    project: string | null = null,
    deliver: string | null = null,
  ): Chat {
    const text = message.trim();
    if (!text) throw new RuleViolation('메시지를 적어요');
    return new Chat(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        agent_id: null,
        pending: text,
        title: ChatHistory.firstLine(text, Chat.TITLE_MAX),
        turns: 0,
        request_id: requestId,
        device_id: deviceId,
        goal: goal?.trim() || null,
        project,
        deliver,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: ChatRow): Chat {
    return new Chat(row);
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  /** 맡은 에이전트. 맡기 전(배정 · 질문 중)이면 null */
  get agentId(): string | null {
    return this.row.agent_id;
  }

  /** 맡은 에이전트. 맡기 전이면 RuleViolation (회차 · 카드는 맡은 대화에만 생긴다) */
  get partnerId(): string {
    if (this.row.agent_id === null) throw new RuleViolation('아직 맡은 에이전트가 없어요');
    return this.row.agent_id;
  }

  /** 맡기 전에 받은 첫 메시지 (맡으면 첫 회차가 되고 비워진다) */
  get pending(): string | null {
    return this.row.pending;
  }

  get turns(): number {
    return this.row.turns;
  }

  get goal(): string | null {
    return this.row.goal;
  }

  /** 받을 것 (비우면 대화 답) */
  get deliver(): string | null {
    return this.row.deliver;
  }

  /**
   * 보내는 쪽이 이 대화에 말할 수 있는가. 관리자(deviceId null)는 모든 대화에, 기기는 자기가 연 대화에만:
   * 관리자의 대화를 이어 쓰면 앞 대화(비공개일 수 있다)가 그 기기의 회차에 실린다. 남의 대화는 없는 것처럼 (404)
   */
  assertSender(deviceId: string | null): void {
    if (deviceId !== null && this.row.device_id !== deviceId)
      throw new NotFound('대화를 찾을 수 없어요');
  }

  /**
   * 메시지 하나 → 상대에게 맡기는 작업 하나 (다음 회차). previous는 앞 회차 작업들 (오래된 것부터).
   * 앞 회차가 끝나지 않았으면 Conflict: 채팅처럼 한 번에 하나씩 주고받는다 (답을 보고 다음 말을 한다).
   * 기기가 보낸 메시지(deviceId)는 관리자가 쓴 글이 아니라 그 기기의 AI가 쓴 글일 수 있다: payload에 via: device를 남겨
   * read_url의 기준(관리자의 지시)에 넣지 않는다 (WebQuery.ownerText)
   */
  send(
    agent: Agent,
    requestId: string,
    message: string,
    previous: readonly ChatTurnRow[],
    now: Date,
    deviceId: string | null = null,
    /** 받을 것이 없어 서버가 다시 맡기는 회차 (payload.chat.fix) */
    fix = false,
  ): Task {
    if (agent.id !== this.row.agent_id) throw new RuleViolation('이 대화의 상대가 아니에요');
    ChatRoute.assertPartner(agent);
    if (ChatHistory.waiting(previous.at(-1)))
      throw new Conflict('답을 기다리는 중이에요. 답이 오거나 취소한 뒤에 보내요');
    const text = message.trim();
    if (!text) throw new RuleViolation('메시지를 적어요');
    const turn = this.row.turns + 1;
    this.put('turns', turn);
    this.put('updated_at', now);
    this.changed();
    return Task.open(
      this.row.space_id,
      ChatRequest.turn(this.id, turn),
      {
        kind: Task.GENERAL,
        agent_id: agent.id,
        title: `대화 · ${ChatHistory.firstLine(text, Chat.TASK_TITLE)}`,
        instruction: text,
        payload: {
          chat: {
            chatId: this.id,
            turn,
            requestId,
            history: ChatHistory.of(previous),
            ...(deviceId === null ? {} : { via: 'device', device: deviceId }),
            ...(fix ? { fix: true } : {}),
          },
        },
      },
      now,
    );
  }

  /**
   * 받을 것이 결과에 없어 같은 상대에게 다시 맡긴다 (서버가 연다, 2차 2단계). message는 지시문 틀 result-check로 채운 글이고
   * 관리자의 글이 아니라서 payload.chat.fix로 표시한다 (화면이 "검사"로 보인다)
   */
  fix(agent: Agent, message: string, previous: readonly ChatTurnRow[], now: Date): Task {
    return this.send(agent, `fix:${this.row.turns + 1}`, message, previous, now, null, true);
  }

  /**
   * 회차의 결과를 결재 전에 검토자(다른 AI 도구의 에이전트)가 본다 (검토자 짝, 2차 2단계). 회차마다 하나 (request_id).
   * instruction은 지시문 틀 result-review로 채운 글. 답은 소식(review)과 결과 카드에 실린다
   */
  review(reviewer: Agent, instruction: string, now: Date): Task {
    return Task.open(
      this.row.space_id,
      ChatRequest.review(this.id, this.row.turns),
      {
        kind: Task.GENERAL,
        agent_id: reviewer.id,
        title: `검토 · ${ChatHistory.firstLine(this.row.title, Chat.TASK_TITLE)}`,
        instruction,
        payload: { chat: { chatId: this.id, turn: this.row.turns, review: true } },
      },
      now,
    );
  }

  /**
   * 끝나지 않은 회차(current)에 덧붙인다: 소식 한 줄, 그리고 회차가 이미 돌고 있으면 대표가 짧게 답하는 작업 하나를 돌려준다
   * (대기열의 회차는 빌릴 때 덧붙인 말을 함께 받으니 따로 답하지 않는다). 회차는 그대로 두어 팀은 하던 일을 계속한다.
   * appended: 이 회차에 이미 덧붙인 수 (회차마다 APPEND_MAX개)
   */
  appendTo(
    current: ChatTurnRow,
    agent: Agent,
    requestId: string,
    message: string,
    previous: readonly ChatTurnRow[],
    appended: number,
    now: Date,
    deviceId: string | null = null,
  ): Task | null {
    if (agent.id !== this.row.agent_id) throw new RuleViolation('이 대화의 상대가 아니에요');
    ChatRoute.assertPartner(agent);
    if (appended >= ChatUpdates.APPEND_MAX)
      throw new RuleViolation(`덧붙인 말은 회차마다 ${ChatUpdates.APPEND_MAX}개까지예요`);
    const text = message.trim();
    if (text.length > ChatUpdates.TEXT_MAX)
      throw new RuleViolation(`덧붙인 말은 ${ChatUpdates.TEXT_MAX}자까지예요`);
    this.note(ChatUpdates.APPENDED, text, current.id, null, now);
    this.put('updated_at', now);
    this.changed();
    if (current.status === Task.QUEUED) return null;
    const turn = this.row.turns;
    return Task.open(
      this.row.space_id,
      `${ChatRequest.turn(this.id, turn)}:reply:${appended + 1}`,
      {
        kind: Task.GENERAL,
        agent_id: agent.id,
        title: `대화 · ${ChatHistory.firstLine(text, Chat.TASK_TITLE)}`,
        instruction: text,
        payload: {
          chat: {
            chatId: this.id,
            turn,
            reply: true,
            requestId,
            history: ChatHistory.of(previous),
            ...(deviceId === null ? {} : { via: 'device', device: deviceId }),
          },
        },
      },
      now,
    );
  }

  /**
   * 맡긴다 (2차 1-5): 상대를 정하고 맡기 전의 첫 메시지로 첫 회차를 연다. 맡음 소식(routed)을 남긴다.
   * reason: 배정 일이 고른 까닭 (없으면 이름), deliver: 배정 일이 고른 받을 것 (열 때 정했으면 그대로), routeTaskId: 고른 배정 일
   */
  assign(
    agent: Agent,
    now: Date,
    reason = '',
    deliver: string | null = null,
    routeTaskId: string | null = null,
  ): Task {
    const message = this.row.pending;
    if (this.row.agent_id !== null || message === null) throw new Conflict('이미 맡은 대화예요');
    ChatRoute.assertPartner(agent);
    this.put('agent_id', agent.id);
    this.put('pending', null);
    if (deliver && !this.row.deliver) this.put('deliver', deliver);
    this.note(ChatUpdates.ROUTED, reason || agent.name, routeTaskId, agent.id, now);
    this.announce(Chat.ROUTED, { agent: agent.name });
    return this.send(agent, this.row.request_id, message, [], now, this.row.device_id);
  }

  /** 맡을 에이전트를 AI가 한 번 고른다 (배정 일, 에이전트 없이 tool로 돈다). instruction은 지시문 틀 chat-route로 채운 글 */
  route(tool: string, instruction: string, now: Date): Task {
    this.assertPending();
    this.touch(now);
    return Task.open(
      this.row.space_id,
      `${ChatRequest.route(this.id)}${BaseEntity.newId()}`,
      {
        kind: Task.ROUTE,
        title: `배정 · ${ChatHistory.firstLine(this.row.title, Chat.TASK_TITLE)}`,
        instruction,
        payload: { tool, route: { chatId: this.id } },
        priority: Chat.ROUTE_PRIORITY,
      },
      now,
    );
  }

  /** 관리자에게 묻는다: 어느 에이전트에게 맡길지 (choices에서 고른다). routeTaskId: 이 질문을 낸 배정 일 */
  ask(question: string, choices: readonly Agent[], now: Date, routeTaskId: string | null = null) {
    this.assertPending();
    this.note(
      ChatUpdates.QUESTION,
      question,
      routeTaskId,
      null,
      now,
      choices.map((a) => a.id),
    );
    this.announce(Chat.ASKED, { question });
    this.touch(now);
  }

  /** 맡기 전에 글로 한 답 (고를 것을 가리키지 않는 말). answered: 이미 한 답의 수. 첫 회차에 덧붙인 말로 함께 간다 */
  answer(text: string, answered: number, now: Date): void {
    this.assertPending();
    if (answered >= ChatRoute.ANSWER_MAX)
      throw new RuleViolation(`맡기 전의 답은 ${ChatRoute.ANSWER_MAX}개까지예요`);
    this.note(ChatUpdates.APPENDED, text, null, null, now);
    this.touch(now);
  }

  /** 끝난 작업의 소식 (ChatUpdateService). 회차의 최종 답이면 알림 이벤트도 (답은 앞부분만) */
  settled(kind: string, text: string, taskId: string, agentId: string | null, now: Date): void {
    this.note(kind, text, taskId, agentId, now);
    if (kind === ChatUpdates.FINAL) this.announce(Chat.ANSWERED, { text: text.slice(0, 300) });
  }

  /** 소식 한 줄을 남긴다 (끝난 작업 · post_update · 덧붙인 말). 저장할 때 함께 쌓인다 */
  note(
    kind: string,
    text: string,
    taskId: string | null,
    agentId: string | null,
    now: Date,
    choices: readonly string[] | null = null,
  ): void {
    this.added.push({
      id: BaseEntity.newId(),
      space_id: this.row.space_id,
      chat_id: this.id,
      kind,
      text: ChatUpdates.text(text),
      task_id: taskId,
      agent_id: agentId,
      choices: choices ? [...choices] : null,
      created_at: now,
    });
  }

  /** 에이전트가 일하는 도중에 남기는 소식 (MCP post_update). posted: 그 작업이 이미 남긴 수 */
  post(kind: string, text: string, taskId: string, agentId: string, posted: number, now: Date) {
    if (!ChatUpdates.POSTED.includes(kind))
      throw new RuleViolation(`종류는 ${ChatUpdates.POSTED.join(' · ')} 중 하나예요`);
    if (posted >= ChatUpdates.POST_MAX)
      throw new RuleViolation(`소식은 작업마다 ${ChatUpdates.POST_MAX}개까지예요`);
    this.note(kind, text, taskId, agentId, now);
  }

  /** 저장할 새 소식 (Repository가 부른다) */
  get addedUpdates(): readonly ChatUpdateNew[] {
    return this.added;
  }

  view(): ChatView {
    return new ChatView(this.row);
  }

  private assertPending(): void {
    if (this.row.agent_id !== null) throw new Conflict('이미 맡은 대화예요');
  }

  private touch(now: Date): void {
    this.put('updated_at', now);
    this.changed();
  }

  private announce(name: string, data: Readonly<Record<string, unknown>>): void {
    this.record(
      new DomainEvent(name, 1, this.row.space_id, {
        chatId: this.id,
        title: this.row.title,
        ...data,
      }),
    );
  }

  private changed(): void {
    this.announce(Chat.CHANGED, { turns: this.row.turns });
  }
}
