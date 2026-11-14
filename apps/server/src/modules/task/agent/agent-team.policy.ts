import { RuleViolation } from '../../platform';
import type { AgentTeamRow } from './agent.view';
import { RESEARCH_TEAMS } from './research-teams';
import { WORK_TEAMS } from './work-teams';

// 에이전트 팀 템플릿 (기획서 결정 2026-11-14). 버튼 한 번에 역할 · 권한 · 조직도가 정해진 팀을 만든다.
// 템플릿은 코드에 둔다(research-teams · work-teams): 늘리려면 목록에 하나 더한다.
// 관리자가 고치는 템플릿이 필요해지면 이 자리를 표로 바꾼다 (Service · 화면은 그대로).
// 구성원의 reports_to는 같은 템플릿 안의 key, null이면 관리자에게. 권한은 Agent의 규칙을 그대로 지난다.
// biome-ignore lint/complexity/noStaticOnlyClass: 상태 없는 템플릿 목록 한 곳. 서비스 · 읽기 · 테스트가 함께 쓴다
export class AgentTeams {
  static readonly ALL: readonly AgentTeamRow[] = [...RESEARCH_TEAMS, ...WORK_TEAMS];

  /** key의 템플릿. 없으면 422 */
  static of(key: string): AgentTeamRow {
    const team = AgentTeams.ALL.find((t) => t.key === key);
    if (!team) throw new RuleViolation(`없는 팀 템플릿이에요: ${key}`);
    return team;
  }
}
