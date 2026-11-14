import { ChangeSignal, TableRepository } from '../../platform';
import { Task } from '../task/task';
import { chats, chatUpdates } from '../task.schema';
import type { ChatRow } from '../task.tables';
import { Chat } from './chat';
import { ChatHistory, type ChatTurnRow } from './chat-history.policy';
import type { ChatTurnStateRow } from './chat-result.policy';
import { type ChatPlaceRow, ChatUpdates } from './chat-update.policy';

// task.chats ↔ Chat. 불러오기 · 잠그기 · 저장은 기반이 한다. 소식(task.chat_updates)은 saveParts로 함께 넣는다 (추가만).
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
      SELECT id, instruction, result, status, wait_reason, payload FROM task.tasks
      WHERE space_id = ${spaceId} AND request_id = ANY(${ids}::text[])
      ORDER BY created_at, id`;
  }

  /** 이 회차 작업에 쌓인 그 종류의 소식 수 (덧붙인 말 · post_update의 한도) */
  async countUpdates(taskId: string, kinds: readonly string[]): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM task.chat_updates
      WHERE task_id = ${taskId} AND kind = ANY(${kinds as string[]}::text[])`;
    return row?.count ?? 0;
  }

  /** 이 작업이 그 종류의 소식을 이미 남겼는가 (끝남 소식이 두 번 쌓이지 않게) */
  async hasUpdate(taskId: string, kind: string): Promise<boolean> {
    return (await this.countUpdates(taskId, [kind])) > 0;
  }

  /**
   * 작업이 속한 대화: 위 작업(parent_id)을 따라 맨 위까지 올라가 그 작업의 payload.chat.chatId를 본다.
   * 대화의 일이 아니면 null. 맨 위는 회차 작업이나 덧붙인 말에 답하는 작업이다
   */
  async placeOf(taskId: string): Promise<ChatPlaceRow | null> {
    const [row] = await this.sql<ChatPlaceRow[]>`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 0 AS step FROM task.tasks WHERE id = ${taskId}
        UNION ALL
        SELECT t.id, t.parent_id, up.step + 1 FROM task.tasks t JOIN up ON t.id = up.parent_id
        WHERE up.step < 10
      )
      SELECT t.id, t.status, t.result, t.title, t.agent_id, t.payload, t.space_id,
        root.id AS root_id, root.payload->'chat'->>'chatId' AS chat_id
      FROM task.tasks t
      JOIN LATERAL (SELECT id FROM up ORDER BY step DESC LIMIT 1) top ON true
      JOIN task.tasks root ON root.id = top.id
      WHERE t.id = ${taskId} AND root.payload->'chat'->>'chatId' IS NOT NULL`;
    return row ?? null;
  }

  /**
   * 대화의 일이 아직 도는가 (결과 카드 전, 2차 2단계): 대화의 맨 위 작업들(회차 · 덧붙인 말의 답 · 검토)과 그 아래에서
   * 대기 · 실행 중이거나, 카드에 싣지 않는 결재(바로 알리는 동작)를 기다리는 작업이 있으면 돈다.
   * 하위 작업을 기다리는 작업은 세지 않는다 (그 하위 작업이 센다)
   */
  async busy(chat: Chat): Promise<boolean> {
    const [row] = await this.sql<{ busy: boolean }[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM task.tasks
        WHERE space_id = ${chat.spaceId} AND request_id LIKE ${`${Chat.turnRequestPrefix()}${chat.id}:%`}
        UNION ALL
        SELECT t.id FROM task.tasks t JOIN tree ON t.parent_id = tree.id
      )
      SELECT EXISTS (
        SELECT 1 FROM task.tasks t WHERE t.id IN (SELECT id FROM tree)
          AND (t.status IN (${Task.QUEUED}, ${Task.RUNNING})
            OR (t.status = ${Task.WAITING} AND t.wait_reason = ${Task.WAIT_APPROVAL}
              AND EXISTS (SELECT 1 FROM task.approvals a
                WHERE a.task_id = t.id AND a.status = 'pending' AND a.chat_id IS NULL)))
      ) AS busy`;
    return Boolean(row?.busy);
  }

  /** 지금 회차의 맨 위 작업(상태 · 지시 · 결과)과 그 회차의 검토 작업 */
  async turnState(chat: Chat): Promise<ChatTurnStateRow> {
    const turn = Chat.turnRequestId(chat.id, chat.turns);
    const [row] = await this.sql<ChatTurnStateRow[]>`
      SELECT root.status, root.instruction, root.result,
        review.status AS review_status, review.result AS review_result
      FROM (SELECT 1) one
      LEFT JOIN task.tasks root ON root.space_id = ${chat.spaceId} AND root.request_id = ${turn}
      LEFT JOIN task.tasks review
        ON review.space_id = ${chat.spaceId} AND review.request_id = ${Chat.reviewRequestId(chat.id, chat.turns)}`;
    return (
      row ?? {
        status: null,
        instruction: null,
        result: null,
        review_status: null,
        review_result: null,
      }
    );
  }

  /** 쌓은 소식의 번호 (커서). 저장한 뒤에 읽는다 */
  async numberOf(updateId: string): Promise<number> {
    const [row] = await this.sql<{ n: string }[]>`
      SELECT n FROM task.chat_updates WHERE id = ${updateId}`;
    return Number(row?.n ?? 0);
  }

  protected override async saveParts(chat: Chat): Promise<void> {
    const rows = chat.addedUpdates;
    if (rows.length === 0) return;
    await this.insertRows(chatUpdates, [...rows]);
    await ChangeSignal.send(this.sql, [new ChangeSignal(chat.spaceId, ChatUpdates.TOPIC, chat.id)]);
  }
}
