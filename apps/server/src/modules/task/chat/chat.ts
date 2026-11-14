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
import { ChatUpdates } from './chat-update.policy';

// 대화 하나 (task.chats, 기획서 결정 2026-11-14). 관리자와 바로 아래 에이전트 하나가 채팅처럼 주고받는다.
// 서버 본체에는 AI가 없어서 메시지 하나 = 상대에게 맡기는 작업 하나다 (회차, request_id chat:<대화>:<회차>).
// 이 줄은 머리(상대 · 제목 · 회차 수)만 든다: 메시지는 작업의 지시, 답은 작업의 결과라 두 벌로 두지 않는다.
// 앞 대화는 회차 작업의 payload.chat.history에 자료로 싣는다. read_url의 기준(주인의 글)은 그대로 이번 메시지뿐이다.
// 2차 1-1: 회차가 끝나지 않았을 때 보낸 말은 덧붙인 말이 된다 (appendTo): 소식 한 줄 + 대표가 짧게 답하는 작업 하나.
// 대화의 소식(task.chat_updates, 추가만)은 이 엔티티를 거쳐 쌓인다 (ChatRepository.saveParts)
export class Chat extends TableEntity<ChatRow, ChatNew> {
  /** 화면이 대화 목록 · 대화를 다시 읽는다 (받는 모듈은 없다) */
  static readonly CHANGED = 'task.chat.changed';
  static readonly TITLE_MAX = 80;
  static readonly MESSAGE_MAX = 8000;
  static readonly GOAL_MAX = 300;
  /** 회차 작업의 제목 (작업 메뉴에서 대화의 일인지 알아보게) */
  private static readonly TASK_TITLE = 60;
  /** 이번에 쌓을 소식 (saveParts가 넣는다) */
  private added: ChatUpdateNew[] = [];

  /**
   * 새 대화. 첫 메시지는 send로 (만드는 트랜잭션에서 함께). deviceId: 기기(MCP ask_agent)가 연 대화면 그 기기.
   * goal: 목표 한 줄, project: 맞춘 git 주소 (ChatProject), deliver: 받을 것 (ChatResult.deliverOf). 열 때만 정한다
   */
  static open(
    spaceId: string,
    requestId: string,
    agent: Agent,
    message: string,
    now: Date,
    deviceId: string | null = null,
    goal: string | null = null,
    project: string | null = null,
    deliver: string | null = null,
  ): Chat {
    Chat.assertPartner(agent);
    return new Chat(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        agent_id: agent.id,
        title: Chat.firstLine(message, Chat.TITLE_MAX),
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

  /**
   * 기기(MCP ask_agent)가 고른 상대: 이름이나 id로, 관리자 바로 아래 · 멈추지 않은 · 지우지 않은 에이전트 중에서.
   * 고르지 않으면 기본 대표, 대표가 없으면 하나뿐일 때 그 에이전트. 못 고르면 고를 수 있는 이름을 알린다 (기기의 AI가 다시 부르게)
   */
  static partnerOf(agents: readonly Agent[], wanted: string | null): Agent {
    const choices = agents.filter((a) => a.topLevel && !a.paused && !a.deleted);
    const names =
      choices.map((a) => a.name).join(', ') ||
      '없음 (콘솔에서 관리자 바로 아래 에이전트를 만들어요)';
    const want = wanted?.trim() ?? '';
    const lead = choices.filter((a) => a.lead);
    const found = want
      ? choices.filter((a) => a.id === want || a.name === want)
      : lead.length > 0
        ? lead
        : choices;
    const [only, ...more] = found;
    if (only && more.length === 0) return only;
    if (!want) throw new RuleViolation(`기본 대표가 없어요. 상대를 정해요 (agent): ${names}`);
    if (only) throw new RuleViolation(`같은 이름이 여럿이에요: ${want} (id로 정해요)`);
    throw new RuleViolation(`없는 상대예요: ${want}. 고를 수 있는 상대: ${names}`);
  }

  /** 회차 작업의 request_id 앞부분 (SQL이 대화 id · 회차를 이어 붙인다) */
  static turnRequestPrefix(): string {
    return 'chat:';
  }

  /** 회차 작업의 request_id */
  static turnRequestId(chatId: string, turn: number): string {
    return `${Chat.turnRequestPrefix()}${chatId}:${turn}`;
  }

  /** 회차 하나의 맨 위 작업들의 request_id: 회차 작업과 그 덧붙인 말에 답하는 작업들 (팀의 일은 그 아래) */
  static turnRoots(chatId: string, turn: number): string[] {
    const id = Chat.turnRequestId(chatId, turn);
    const replies = Array.from(
      { length: ChatUpdates.APPEND_MAX },
      (_, k) => `${id}:reply:${k + 1}`,
    );
    return [id, ...replies];
  }

  /** 회차의 결과를 결재 전에 검토하는 작업의 request_id (검토자 짝, 2차 2단계) */
  static reviewRequestId(chatId: string, turn: number): string {
    return `${Chat.turnRequestId(chatId, turn)}:review`;
  }

  /** from회차부터 to회차까지의 request_id (작업을 찾는 데 쓴다) */
  static turnRequestIds(chatId: string, from: number, to: number): string[] {
    const ids: string[] = [];
    for (let turn = Math.max(1, from); turn <= to; turn++)
      ids.push(Chat.turnRequestId(chatId, turn));
    return ids;
  }

  get spaceId(): string {
    return this.row.space_id;
  }

  get agentId(): string {
    return this.row.agent_id;
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

  /** 같은 requestId로 이미 보낸 회차가 마지막에 있는가 (응답을 놓쳐 다시 보낸 것). 그러면 보내지 않는다 */
  alreadySent(previous: readonly ChatTurnRow[], requestId: string): boolean {
    return ChatHistory.sentAs(previous.at(-1), requestId);
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
    Chat.assertPartner(agent);
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
      Chat.turnRequestId(this.id, turn),
      {
        kind: Task.GENERAL,
        agent_id: agent.id,
        title: `대화 · ${Chat.firstLine(text, Chat.TASK_TITLE)}`,
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
      Chat.reviewRequestId(this.id, this.row.turns),
      {
        kind: Task.GENERAL,
        agent_id: reviewer.id,
        title: `검토 · ${Chat.firstLine(this.row.title, Chat.TASK_TITLE)}`,
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
    Chat.assertPartner(agent);
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
      `${Chat.turnRequestId(this.id, turn)}:reply:${appended + 1}`,
      {
        kind: Task.GENERAL,
        agent_id: agent.id,
        title: `대화 · ${Chat.firstLine(text, Chat.TASK_TITLE)}`,
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

  /** 소식 한 줄을 남긴다 (끝난 작업 · post_update · 덧붙인 말). 저장할 때 함께 쌓인다 */
  note(kind: string, text: string, taskId: string | null, agentId: string | null, now: Date): void {
    this.added.push({
      id: BaseEntity.newId(),
      space_id: this.row.space_id,
      chat_id: this.id,
      kind,
      text: ChatUpdates.text(text),
      task_id: taskId,
      agent_id: agentId,
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

  /** 대화 상대: 관리자 바로 아래, 멈추지 않은 에이전트 (지운 에이전트는 불러올 때 이미 없다) */
  private static assertPartner(agent: Agent): void {
    if (!agent.topLevel)
      throw new RuleViolation(
        `관리자 바로 아래 에이전트와만 대화해요: ${agent.name}은(는) 팀원이에요`,
      );
    if (agent.paused) throw new RuleViolation(`멈춘 에이전트예요: ${agent.name} (재개한 뒤에)`);
  }

  private static firstLine(text: string, max: number): string {
    const line = text.trim().split('\n')[0]?.trim() ?? '';
    return (line || '대화').slice(0, max);
  }

  private changed(): void {
    this.record(
      new DomainEvent(Chat.CHANGED, 1, this.row.space_id, {
        chatId: this.id,
        turns: this.row.turns,
      }),
    );
  }
}
