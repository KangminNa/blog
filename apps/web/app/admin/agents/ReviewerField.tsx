import { TOOL_LABELS } from '../../_task/labels';
import type { Agent } from '../../_task/types';

// 에이전트 폼의 "검토자" 칸 (검토자 짝, 2차 2단계). 이 에이전트와 나눈 대화의 회차가 끝나면 결과 카드 전에 검토자가 본다.
// 같은 AI가 만들고 검토하면 같은 곳에서 틀려 다른 AI 도구의 에이전트만 고른다 (서버 Agent.pairReviewer도 막는다).
export function ReviewerField({
  id,
  value,
  tool,
  self,
  agents,
  onChange,
}: {
  id: string;
  value: string;
  /** 이 에이전트의 AI 도구 (같은 도구는 고를 수 없다) */
  tool: string;
  self: string;
  agents: readonly Agent[];
  onChange: (value: string) => void;
}) {
  const choices = agents.filter((a) => a.id !== self && a.tool !== tool);
  return (
    <div className="field">
      <label htmlFor={id}>검토자</label>
      <select
        id={id}
        className="input"
        value={value}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">없음</option>
        {choices.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {TOOL_LABELS[a.tool] ?? a.tool}
          </option>
        ))}
      </select>
      <small id={`${id}-help`}>
        대화의 결과를 결재 전에 다른 AI 도구의 에이전트가 검토해요. 의견은 결과 카드에 실려요
      </small>
    </div>
  );
}
