import { RuleViolation } from '../../platform';
import { Task } from '../task/task';
import type { TaskRow } from '../task.tables';
import type { ChatTurnRow } from './chat-history.policy';

/** 지금 회차의 맨 위 작업과 그 회차의 검토 작업 (ChatRepository.turnState. 없으면 칸이 비어 있다) */
export type ChatTurnStateRow = {
  status: TaskRow['status'] | null;
  instruction: TaskRow['instruction'] | null;
  result: TaskRow['result'] | null;
  review_status: TaskRow['status'] | null;
  review_result: TaskRow['result'] | null;
};

// 결과 결재의 판단 (2차 2단계 · 기획서 결정 2026-11-14). 상태 없음:
//   회차가 가라앉았을 때(도는 일이 없고 남은 일은 카드에 실릴 결재만 기다림) 다음에 할 일 하나,
//   받을 것(chats.deliver)의 검사, 카드에서 고른 항목.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. 결과 카드의 서비스 · 읽기가 함께 쓴다
export class ChatResult {
  static readonly DELIVERS: readonly string[] = ['html', 'blog', 'browser', 'code'];
  /** 검사에 떨어져 팀에게 다시 맡기는 회차 수 (넘으면 떨어진 채로 카드에 보인다) */
  static readonly FIX_MAX = 2;
  /** 다음에 할 일 */
  static readonly NONE = 'none';
  static readonly FIX = 'fix';
  static readonly REVIEW = 'review';
  static readonly CARD = 'card';
  /** 받을 것마다 결과에 있어야 하는 것: 이름 끝이 그것인 결과물, 또는 그 동작의 결재 */
  private static readonly NEEDS: Readonly<Record<string, { output?: string; action?: string }>> = {
    html: { output: '.html' },
    blog: { action: 'blog.post.publish' },
    browser: { action: 'browser.site.publish' },
    code: { action: 'code.pr.merge' },
  };

  /** 받을 것의 모양 검사 (DB CHECK와 같은 목록). 비우면 null (대화 답) */
  static deliverOf(raw: string | null): string | null {
    if (raw === null) return null;
    if (!ChatResult.DELIVERS.includes(raw))
      throw new RuleViolation(`받을 것은 ${ChatResult.DELIVERS.join(' · ')} 중 하나예요`);
    return raw;
  }

  /** 받을 것이 결과에 없으면 그 받을 것, 있거나 정하지 않았으면 null */
  static missing(
    deliver: string | null,
    actions: readonly string[],
    outputs: readonly string[],
  ): string | null {
    const need = deliver === null ? undefined : ChatResult.NEEDS[deliver];
    if (!need) return null;
    const has = need.output
      ? outputs.some((name) => name.toLowerCase().endsWith(need.output as string))
      : actions.includes(need.action as string);
    return has ? null : deliver;
  }

  /** 있어야 하는 것의 이름 (검사 실패 지시문에 싣는다) */
  static needOf(deliver: string): string {
    const need = ChatResult.NEEDS[deliver];
    return need?.output ? `${need.output} 결과물` : `${need?.action ?? deliver} 결재`;
  }

  /**
   * 가라앉은 회차의 다음 할 일. root: 지금 회차 맨 위 작업의 상태 (결재를 기다리다 가라앉았으면 waiting)
   *   회차가 끝났고 받을 것이 없으면(한도 안) → 다시 맡김. 실을 것이 없으면 → 없음.
   *   회차가 끝났고 검토자가 있는데 아직 검토하지 않았으면 → 검토. 그 밖 → 카드
   */
  static next(
    root: string | null,
    items: number,
    missing: boolean,
    fixes: number,
    reviewer: boolean,
    reviewed: boolean,
  ): string {
    const done = root === Task.DONE;
    if (done && missing && fixes < ChatResult.FIX_MAX) return ChatResult.FIX;
    if (items === 0) return ChatResult.NONE;
    if (done && reviewer && !reviewed) return ChatResult.REVIEW;
    return ChatResult.CARD;
  }

  /** 바로 앞까지 이어진 다시 맡긴 회차 수 (payload.chat.fix) */
  static fixesIn(previous: readonly ChatTurnRow[]): number {
    let count = 0;
    for (const turn of [...previous].reverse()) {
      const chat = (turn.payload as { chat?: { fix?: unknown } } | null)?.chat;
      if (chat?.fix !== true) break;
      count += 1;
    }
    return count;
  }

  /** 카드에서 고른 항목. 비우면(null) 모두, 카드에 없는 id면 RuleViolation */
  static picked(picked: readonly string[] | null, ids: readonly string[]): ReadonlySet<string> {
    if (picked === null) return new Set(ids);
    const unknown = picked.filter((id) => !ids.includes(id));
    if (unknown.length > 0) throw new RuleViolation('카드에 없는 항목이에요');
    return new Set(picked);
  }

  /** 결과 글 (작업의 result.text) */
  static textOf(result: unknown): string {
    const text = (result as { text?: unknown } | null)?.text;
    return typeof text === 'string' ? text : '';
  }
}
