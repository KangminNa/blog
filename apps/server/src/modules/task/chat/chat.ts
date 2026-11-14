import { BaseEntity, Conflict, DomainEvent, RuleViolation, TableEntity } from '../../platform';
import type { Agent } from '../agent/agent';
import { Task } from '../task/task';
import type { ChatNew, ChatRow } from '../task.tables';
import { ChatView } from './chat.view';
import { ChatHistory, type ChatTurnRow } from './chat-history.policy';

// 대화 하나 (task.chats, 기획서 결정 2026-11-14). 관리자와 바로 아래 에이전트 하나가 채팅처럼 주고받는다.
// 서버 본체에는 AI가 없어서 메시지 하나 = 상대에게 맡기는 작업 하나다 (회차, request_id chat:<대화>:<회차>).
// 이 줄은 머리(상대 · 제목 · 회차 수)만 든다: 메시지는 작업의 지시, 답은 작업의 결과라 두 벌로 두지 않는다.
// 앞 대화는 회차 작업의 payload.chat.history에 자료로 싣는다. read_url의 기준(주인의 글)은 그대로 이번 메시지뿐이다.
export class Chat extends TableEntity<ChatRow, ChatNew> {
  /** 화면이 대화 목록 · 대화를 다시 읽는다 (받는 모듈은 없다) */
  static readonly CHANGED = 'task.chat.changed';
  static readonly TITLE_MAX = 80;
  static readonly MESSAGE_MAX = 8000;
  /** 회차 작업의 제목 (작업 메뉴에서 대화의 일인지 알아보게) */
  private static readonly TASK_TITLE = 60;

  /** 새 대화. 첫 메시지는 send로 (만드는 트랜잭션에서 함께) */
  static open(spaceId: string, requestId: string, agent: Agent, message: string, now: Date): Chat {
    Chat.assertPartner(agent);
    return new Chat(
      {
        id: BaseEntity.newId(),
        space_id: spaceId,
        agent_id: agent.id,
        title: Chat.firstLine(message, Chat.TITLE_MAX),
        turns: 0,
        request_id: requestId,
        created_at: now,
        updated_at: now,
      },
      true,
    );
  }

  static restore(row: ChatRow): Chat {
    return new Chat(row);
  }

  /** 회차 작업의 request_id */
  static turnRequestId(chatId: string, turn: number): string {
    return `chat:${chatId}:${turn}`;
  }

  /** from회차부터 to회차까지의 request_id (작업을 찾는 데 쓴다) */
  static turnRequestIds(chatId: string, from: number, to: number): string[] {
    const ids: string[] = [];
    for (let turn = Math.max(1, from); turn <= to; turn++)
      ids.push(Chat.turnRequestId(chatId, turn));
    return ids;
  }

  get agentId(): string {
    return this.row.agent_id;
  }

  get turns(): number {
    return this.row.turns;
  }

  /** 같은 requestId로 이미 보낸 회차가 마지막에 있는가 (응답을 놓쳐 다시 보낸 것). 그러면 보내지 않는다 */
  alreadySent(previous: readonly ChatTurnRow[], requestId: string): boolean {
    return ChatHistory.sentAs(previous.at(-1), requestId);
  }

  /**
   * 관리자의 메시지 하나 → 상대에게 맡기는 작업 하나 (다음 회차). previous는 앞 회차 작업들 (오래된 것부터).
   * 앞 회차가 끝나지 않았으면 Conflict: 채팅처럼 한 번에 하나씩 주고받는다 (답을 보고 다음 말을 한다)
   */
  send(
    agent: Agent,
    requestId: string,
    message: string,
    previous: readonly ChatTurnRow[],
    now: Date,
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
        payload: { chat: { chatId: this.id, turn, requestId, history: ChatHistory.of(previous) } },
      },
      now,
    );
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
