import { RuleViolation } from '../../platform';
import { Task } from '../task/task';
import type { TaskRow } from '../task.tables';

/** 끝난 작업과 그 작업이 속한 대화 (ChatRepository.placeOf가 위로 올라가 찾는다) */
export type ChatPlaceRow = Pick<
  TaskRow,
  'id' | 'status' | 'result' | 'title' | 'agent_id' | 'payload' | 'space_id'
> & { chat_id: string; root_id: string };

// 대화의 소식 (task.chat_updates, 2차 1-1 · docs/API설계.md 4장 agent_updates). 무엇이 소식이 되는지 한 곳에서 정한다.
//   팀원(하위 작업)이 끝남 · 실패 → member_done · member_failed, 회차가 끝남 · 실패 → final · failed,
//   덧붙인 말에 대표가 답함 → reply, 검토자 짝이 결과를 검토함 → review (2차 2단계),
//   에이전트가 post_update로 남김 → progress · decision · assumption, 덧붙인 말 → appended.
// 글은 AI가 쓴 결과 · 관리자의 말을 자르기만 한다 (설명 문장을 코드에서 덧붙이지 않는다). 취소는 소식이 아니다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. Chat · ChatRepository · Query가 함께 쓴다
export class ChatUpdates {
  /** 소식이 쌓였다는 변경 신호 (agent_updates가 기다린다. 이벤트가 아니다) */
  static readonly TOPIC = 'task.chat.updated';
  static readonly TEXT_MAX = 2000;
  static readonly APPENDED = 'appended';
  static readonly REPLY = 'reply';
  static readonly REVIEW = 'review';
  /** 에이전트가 post_update로 남기는 종류 (작업마다 POST_MAX개) */
  static readonly POSTED: readonly string[] = ['progress', 'decision', 'assumption'];
  static readonly POST_MAX = 20;
  /** 덧붙인 말은 회차마다 이만큼 */
  static readonly APPEND_MAX = 5;

  /** 소식의 글: 앞뒤 공백을 떼고 TEXT_MAX자로 자른다. 비었으면 RuleViolation */
  static text(raw: string): string {
    const body = raw.trim();
    if (!body) throw new RuleViolation('소식의 글이 비었어요');
    return ChatUpdates.cut(body, ChatUpdates.TEXT_MAX);
  }

  /** 끝난 작업이 남기는 소식의 종류와 글. 소식이 아니면 null (취소 · 아직 안 끝남) */
  static settled(place: ChatPlaceRow): { kind: string; text: string } | null {
    const result = (place.result ?? {}) as { text?: unknown; error?: unknown };
    const said = typeof result.text === 'string' ? result.text.trim() : '';
    const error = typeof result.error === 'string' ? result.error : '';
    const root = place.id === place.root_id;
    const chat = (place.payload as { chat?: { reply?: unknown; review?: unknown } } | null)?.chat;
    if (place.status === Task.DONE) {
      if (!root) return { kind: 'member_done', text: `${place.title} — ${said || '-'}` };
      if (chat?.reply) return { kind: ChatUpdates.REPLY, text: said || '-' };
      if (chat?.review) return { kind: ChatUpdates.REVIEW, text: said || '-' };
      const path = `/admin/chats/${place.chat_id}`;
      return { kind: 'final', text: `${ChatUpdates.cut(said || '-', 1700)}\n\n${path}` };
    }
    if (place.status === Task.FAILED) {
      if (!root) return { kind: 'member_failed', text: `${place.title} — ${error || '-'}` };
      return { kind: 'failed', text: error || '-' };
    }
    return null;
  }

  private static cut(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
}
