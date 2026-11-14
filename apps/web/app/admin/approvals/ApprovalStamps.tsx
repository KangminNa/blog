'use client';

import { useMe } from '../../_account/live';
import type { Approval } from '../../_task/types';

const SEALS: Record<string, string> = {
  approved: '승인',
  rejected: '반려',
  revision_requested: '수정',
  cancelled: '취소',
};

/** 결재선: 요청 → 결재. 결재 칸에는 결재하는 사람(관리자)의 이름 */
export function Stamps({ approval, requester }: { approval: Approval; requester: string }) {
  const seal = SEALS[approval.status];
  const decider = useMe().data?.name ?? '관리자';
  return (
    <div
      className="stamps"
      role="img"
      aria-label={`요청 ${requester}, 결재 ${decider} ${seal ?? '대기'}`}
    >
      <div className="stamp-cell">
        <span>요청</span>
        <div>{requester}</div>
      </div>
      <div className="stamp-cell">
        <span>결재 · {decider}</span>
        <div>
          <span className={seal ? 'seal' : 'seal blank'}>{seal ?? '대기'}</span>
        </div>
      </div>
    </div>
  );
}
