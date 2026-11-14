import { APPROVAL_STATUS, taskStatusLabel, tokens } from './labels';
import type { Agent } from './types';

// 상태는 색 없이 채움·테두리·굵기로 구분한다.

export function TaskPill({
  status,
  waitReason = null,
}: {
  status: string;
  /** 기다리는 중이면 무엇을 (approval · subtasks) */
  waitReason?: string | null;
}) {
  const look =
    status === 'waiting'
      ? 'pill on'
      : status === 'failed'
        ? 'pill strong'
        : status === 'cancelled'
          ? 'pill off'
          : 'pill';
  return (
    <span className={look}>
      {status === 'running' && <span className="dot run" aria-hidden="true" />}
      {taskStatusLabel(status, waitReason)}
    </span>
  );
}

export function ApprovalPill({ status }: { status: string }) {
  const look =
    status === 'pending'
      ? 'pill on'
      : status === 'rejected'
        ? 'pill strong'
        : status === 'cancelled'
          ? 'pill off'
          : 'pill';
  return <span className={look}>{APPROVAL_STATUS[status] ?? status}</span>;
}

/** 이번 달 사용량과 한도. 숫자가 함께 보이므로 막대는 읽어 주지 않는다 */
export function AgentUsage({ agent }: { agent: Agent }) {
  const { usedThisMonth: used, monthlyLimit: limit } = agent;
  const over = limit !== null && used > limit;
  return (
    <div className="usage">
      <div className="usage-text">
        <span>이번 달 사용량</span>
        <span className={over ? 'mono strong' : 'mono'}>
          {limit === null
            ? `${tokens(used)} 토큰 · 한도 없음`
            : `${tokens(used)} / ${tokens(limit)} 토큰${over ? ' · 한도 초과' : ''}`}
        </span>
      </div>
      {limit !== null && (
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${Math.min(100, Math.round((used / limit) * 100))}%` }} />
        </div>
      )}
    </div>
  );
}

/** HTML 결과물인가 (서버의 OutputPolicy.canView와 같다: 이름으로) */
export const isHtmlOutput = (name: string) => /\.html?$/i.test(name);

/**
 * 결과물 하나를 여는 링크. HTML은 새 탭에서 격리해 연다(서버의 view=1, AI가 만든 페이지와 같은 격리),
 * 나머지는 내려받기
 */
export function OutputOpen({ id, name }: { id: string; name: string }) {
  return isHtmlOutput(name) ? (
    <a className="ghost" href={`/api/outputs/${id}/file?view=1`} target="_blank" rel="noopener">
      열기
    </a>
  ) : (
    <a className="ghost" href={`/api/outputs/${id}/file`} download={name}>
      내려받기
    </a>
  );
}
