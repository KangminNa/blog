import { Task } from '../task/task';
import type { TaskRow } from '../task.tables';

/** 앞 회차 작업에서 이전 대화를 만드는 데 읽는 칸 */
export type ChatTurnRow = Pick<
  TaskRow,
  'id' | 'instruction' | 'result' | 'status' | 'wait_reason' | 'payload'
>;

// 회차 작업에 싣는 이전 대화 (payload.chat.history). 러너가 "이전 대화 (자료)"로 그린다.
// 관리자의 메시지(작업의 지시)와 에이전트의 답(작업의 결과)을 번갈아, 최근 회차만 잘라서 싣는다:
// 메시지마다 AI를 새로 띄우므로 길어질수록 느리고 토큰이 든다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Chat과 ChatRepository가 함께 쓴다
export class ChatHistory {
  /** 실을 앞 회차 수 */
  static readonly TURNS = 20;
  /** 메시지 · 답 하나의 길이 */
  static readonly TEXT_MAX = 4000;

  /** 앞 회차들(오래된 것부터) → [{ from: 'owner' | 'agent', text }] */
  static of(previous: readonly ChatTurnRow[]): Record<string, string>[] {
    return previous.slice(-ChatHistory.TURNS).flatMap((turn) => [
      { from: 'owner', text: ChatHistory.cut(turn.instruction) },
      { from: 'agent', text: ChatHistory.cut(ChatHistory.answerOf(turn)) },
    ]);
  }

  /** 같은 요청(requestId)으로 이미 보낸 회차인가: 응답을 놓쳐 다시 보낸 것 */
  static sentAs(turn: ChatTurnRow | undefined, requestId: string): boolean {
    const chat = (turn?.payload as { chat?: { requestId?: unknown } } | null)?.chat;
    return chat?.requestId === requestId;
  }

  /** 앞 회차가 아직 끝나지 않았는가 (답을 기다리는 중) */
  static waiting(turn: ChatTurnRow | undefined): boolean {
    return turn !== undefined && [Task.QUEUED, Task.RUNNING, Task.WAITING].includes(turn.status);
  }

  private static answerOf(turn: ChatTurnRow): string {
    const result = (turn.result ?? {}) as { text?: unknown; error?: unknown };
    if (typeof result.text === 'string' && result.text.trim()) return result.text;
    if (typeof result.error === 'string') return `(실패: ${result.error})`;
    return turn.status === Task.CANCELLED ? '(취소됨)' : '(답 없음)';
  }

  private static cut(text: string): string {
    return text.length > ChatHistory.TEXT_MAX
      ? `${text.slice(0, ChatHistory.TEXT_MAX)} …(줄임)`
      : text;
  }
}
