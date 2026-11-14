import { Actor, Forbidden, RuleViolation } from '../../platform';
import type { Agent } from '../agent/agent';

// 위임 하나의 판단 (Task.subtask가 부른다). 받는 쪽 · 종류 · 권한은 코드가 막고 LLM에게 맡기지 않는다.
// 브라우저 일(browse, 2차 3단계 2026-11-14)은 맡기는 쪽도 비공개(전체 읽기 · 초안 작성)를 읽지 못해야 한다:
// 맡기는 쪽이 쓴 지시문이 곧 브라우저 담당의 재료라서, 비공개가 지시문을 타고 바깥 사이트로 갈 수 있다.
// 그런 대표는 브라우저 일을 맡기지 못하고, 관리자가 브라우저 메뉴에서 맡긴다
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 판단 한 곳
export class DelegationPolicy {
  /** 브라우저 일을 맡기는 쪽에게 없어야 하는 권한 (browse와 함께 줄 수 없는 권한과 같다) */
  private static readonly NOT_WITH_BROWSE: readonly string[] = [Actor.READ_ALL, Actor.WRITE];

  /**
   * 받는 쪽은 manager의 바로 아래 팀원, 종류는 위임할 수 있는 것(delegable), 받는 쪽은 그 일에 필요한 권한(needs)을 가졌는가.
   * 필요한 권한에 browse가 있으면 맡기는 쪽에게 전체 읽기 · 초안 작성이 없어야 한다
   */
  static assert(
    manager: Agent,
    worker: Agent | null,
    kind: string,
    delegable: readonly string[],
    needs: readonly string[],
  ): asserts worker is Agent {
    if (worker === null || !manager.manages(worker))
      throw new Forbidden(Actor.AGENT, '바로 아래 팀원에게만 맡길 수 있어요');
    if (!delegable.includes(kind))
      throw new RuleViolation(`맡길 수 있는 일은 ${delegable.join(' · ')}예요: ${kind}`);
    if (!needs.every((scope) => worker.scopes.includes(scope)))
      throw new RuleViolation(`${worker.name}의 권한으로는 할 수 없는 일이에요: ${kind}`);
    const reader = DelegationPolicy.NOT_WITH_BROWSE.some((s) => manager.scopes.includes(s));
    if (needs.includes(Actor.BROWSE) && reader)
      throw new RuleViolation(
        '전체 읽기 · 초안 작성 권한이 있는 에이전트는 브라우저 일을 맡기지 못해요 (관리자가 브라우저 메뉴에서 맡겨요)',
      );
  }
}
