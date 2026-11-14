import { RuleViolation } from '../../platform';
import type { Agent } from '../agent/agent';
import { ChatResult } from './chat-result.policy';

/** 배정 일의 답을 읽은 결과: 맡을 에이전트, 아니면 관리자에게 물을 질문과 고를 에이전트 */
export type ChatRouteDecision =
  | { kind: 'agent'; agent: Agent; reason: string; deliver: string | null }
  | { kind: 'question'; question: string; choices: readonly Agent[] };

// 배정 (2차 1-5 · 기획서 결정 2026-11-14): 새 대화는 "맡는 일"(역할의 첫 줄)이 맞는 에이전트가 맡는다.
// 후보는 관리자 바로 아래 · 멈추지 않은 · 지우지 않은 에이전트 중 다른 에이전트의 검토자가 아닌 것 (검토만 하는 에이전트는 맡지 않는다).
// 하나면 바로 맡기고, 여럿이면 AI가 한 번 고른다 (지시문 틀 chat-route, 답은 JSON 한 줄). 애매하면 대화로 묻는다.
// AI의 답은 자료다: 후보 밖의 이름 · 모양이 틀린 답은 받지 않고 후보 전부로 묻는다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳. ChatService만 쓴다
export class ChatRoute {
  /** 서버가 AI 없이 묻는 말 (배정 일이 없거나 답이 틀렸을 때) */
  static readonly QUESTION = '어느 에이전트에게 맡길까요?';
  static readonly NONE = '대화를 맡을 에이전트가 없어요. 설정 › 에이전트에서 추가해요';
  /** 배정 일이 이만큼 빌려 가지 않으면 서버가 대신 묻는다 */
  static readonly WAIT_MS = 60_000;
  /** 맡기 전에 글로 답할 수 있는 수 */
  static readonly ANSWER_MAX = 5;
  private static readonly QUESTION_MAX = 300;
  private static readonly REASON_MAX = 200;

  static candidates(agents: readonly Agent[]): Agent[] {
    const reviewers = new Set(agents.filter((a) => !a.deleted).map((a) => a.reviewerId));
    return agents.filter((a) => a.topLevel && !a.paused && !a.deleted && !reviewers.has(a.id));
  }

  /** 기기(MCP ask_agent)가 이름이나 id로 고른 상대. 못 고르면 고를 수 있는 이름을 알린다 (기기의 AI가 다시 부르게) */
  static wanted(agents: readonly Agent[], wanted: string): Agent {
    const choices = agents.filter((a) => a.topLevel && !a.paused && !a.deleted);
    const want = wanted.trim();
    const found = choices.filter((a) => a.id === want || a.name === want);
    const [only, ...more] = found;
    if (only && more.length === 0) return only;
    if (only) throw new RuleViolation(`같은 이름이 여럿이에요: ${want} (id로 정해요)`);
    const names = choices.map((a) => a.name).join(', ') || '없음';
    throw new RuleViolation(`없는 상대예요: ${want}. 고를 수 있는 상대: ${names}`);
  }

  /** 글로 한 답이 고를 것 하나를 가리키는가: 번호("1", "1번") 또는 이름 그대로. 아니면 null */
  static chosen(text: string, choices: readonly Agent[]): Agent | null {
    const said = text.trim().replace(/\s+/g, '').replace(/번$/, '').toLowerCase();
    const index = /^\d+$/.test(said) ? Number(said) - 1 : -1;
    if (index >= 0) return choices[index] ?? null;
    return choices.find((a) => a.name.replace(/\s+/g, '').toLowerCase() === said) ?? null;
  }

  /** 지시문 틀 chat-route에 넣을 후보 목록 (한 줄에 하나: id · 이름: 맡는 일) */
  static listOf(candidates: readonly Agent[]): string {
    return candidates.map((a) => `- ${a.id} · ${a.name}: ${a.duty || '-'}`).join('\n');
  }

  /**
   * 배정 일의 답을 읽는다. { "agent": id, "reason": 한 줄, "deliver"?: 받을 것 } 이면 맡기고,
   * { "question": 질문, "choices": [id, …] } 이면 묻는다 (고를 것이 둘 미만이면 후보 전부). 읽지 못하면 서버의 질문
   */
  static parse(text: string, candidates: readonly Agent[]): ChatRouteDecision {
    const json = ChatRoute.jsonOf(text);
    const fallback: ChatRouteDecision = {
      kind: 'question',
      question: ChatRoute.QUESTION,
      choices: candidates,
    };
    if (!json) return fallback;
    const agent = candidates.find((a) => a.id === json.agent || a.name === json.agent);
    if (agent) {
      const deliver = typeof json.deliver === 'string' ? json.deliver : '';
      return {
        kind: 'agent',
        agent,
        reason: ChatRoute.cut(json.reason, ChatRoute.REASON_MAX),
        deliver: ChatResult.DELIVERS.includes(deliver) ? deliver : null,
      };
    }
    const question = ChatRoute.cut(json.question, ChatRoute.QUESTION_MAX);
    if (!question) return fallback;
    // 고를 것은 AI가 준 순서대로 (질문의 번호가 그 순서를 가리킨다), 후보 밖과 겹친 것은 뺀다
    const wanted: unknown[] = Array.isArray(json.choices) ? json.choices : [];
    const choices = [
      ...new Set(wanted.map((w) => candidates.find((a) => a.id === w || a.name === w))),
    ].filter((a): a is Agent => a !== undefined);
    return { kind: 'question', question, choices: choices.length >= 2 ? choices : candidates };
  }

  /** 답의 마지막 JSON 객체 (앞뒤에 다른 글이나 코드 울타리가 있어도) */
  private static jsonOf(text: string): Record<string, unknown> | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private static cut(value: unknown, max: number): string {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }
}
