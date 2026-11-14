import { TableRepository } from '../../platform';
import { chats } from '../task.schema';
import type { ChatRow } from '../task.tables';
import { Chat } from './chat';
import { ChatHistory, type ChatTurnRow } from './chat-history.policy';

// task.chats ↔ Chat. 불러오기 · 잠그기 · 저장은 기반이 한다.
// 앞 회차(작업)는 이 대화의 회차 request_id로만 읽는다: 작업 쪽에 대화를 가리키는 칸을 두지 않는다 (목표 실행과 같다).
export class ChatRepository extends TableRepository<ChatRow, Chat> {
  protected readonly table = chats;
  protected readonly noun = '대화';

  protected toEntity(row: ChatRow): Chat {
    return Chat.restore(row);
  }

  /** 같은 requestId로 이미 만든 대화 (응답을 놓쳐 다시 누른 것) */
  findByRequest(spaceId: string, requestId: string): Promise<Chat | null> {
    return this.findOne({ space_id: spaceId, request_id: requestId });
  }

  /** 이전 대화를 만들 앞 회차들 (최근 ChatHistory.TURNS개, 오래된 것부터) */
  previousTurns(chat: Chat, spaceId: string): Promise<ChatTurnRow[]> {
    const ids = Chat.turnRequestIds(chat.id, chat.turns - ChatHistory.TURNS + 1, chat.turns);
    if (ids.length === 0) return Promise.resolve([]);
    return this.sql<ChatTurnRow[]>`
      SELECT instruction, result, status, payload FROM task.tasks
      WHERE space_id = ${spaceId} AND request_id = ANY(${ids}::text[])
      ORDER BY created_at, id`;
  }
}
