'use client';

import { useAgents, useUsage } from '../../_task/live';
import { UsageBlock } from '../../_task/UsageBlock';

// 사용량 (2차 1-5: 홈에서 설정 › AI로 옮겼다): 구독 창의 사용률과 에이전트마다의 토큰 · 한도
export function UsagePanel() {
  const usage = useUsage();
  const agents = useAgents();
  return (
    <>
      {usage.error && <p className="error">{usage.error}</p>}
      <UsageBlock usage={usage.data} agents={agents.data?.agents} />
    </>
  );
}
