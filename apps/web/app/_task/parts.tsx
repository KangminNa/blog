import { APPROVAL_STATUS, TASK_STATUS, tokens } from './labels';
import type { Agent } from './types';

// 상태는 색 없이 채움·테두리·굵기로 구분한다.

export function TaskPill({ status }: { status: string }) {
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
      {TASK_STATUS[status] ?? status}
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
