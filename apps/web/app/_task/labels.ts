import type { UsageAgent } from './types';

// 작업·결재·에이전트의 화면 이름과 표시 형식

export const TASK_STATUS: Record<string, string> = {
  queued: '대기',
  running: '실행 중',
  waiting: '결재 대기',
  done: '완료',
  failed: '실패',
  cancelled: '취소',
};

/** 기다리는 작업이 무엇을 기다리는지 (서버의 Task.WAIT_*) */
export const WAIT_LABELS: Record<string, string> = {
  approval: '결재 대기',
  subtasks: '하위 작업 대기',
};

/** 작업 상태의 이름. 기다리는 중이면 무엇을 기다리는지까지 */
export function taskStatusLabel(status: string, waitReason: string | null = null): string {
  if (status === 'waiting' && waitReason) return WAIT_LABELS[waitReason] ?? '결재 대기';
  return TASK_STATUS[status] ?? status;
}

/** 취소할 수 있는 상태 (서버의 Task.cancel과 맞춘다) */
export const CANCELLABLE: readonly string[] = ['queued', 'running', 'waiting'];

export const APPROVAL_STATUS: Record<string, string> = {
  pending: '대기',
  approved: '승인',
  revision_requested: '수정 요청',
  rejected: '반려',
  cancelled: '취소',
};

export const PUBLISH_POST = 'blog.post.publish';
export const RAISE_LIMIT = 'task.agent.raise_limit';

export const ACTION_LABELS: Record<string, string> = {
  [PUBLISH_POST]: '글 공개',
  'sns.post.send': 'SNS 전송',
  [RAISE_LIMIT]: '한도 변경',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export const TARGET_LABELS: Record<string, string> = { post: '글', agent: '에이전트' };

export const EVENT_KINDS: Record<string, string> = {
  read: '읽기',
  write: '쓰기',
  result: '완료',
  error: '오류',
};

export const TOOL_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };

/** 목표 상태 (서버의 Goal.STATUSES와 맞춘다) */
export const GOAL_STATUS: Record<string, string> = {
  active: '진행 중',
  done: '달성',
  dropped: '중단',
};

/**
 * 나무를 위에서부터 펼친다 (목표, 조직도). 형제는 받은 순서 그대로, 부모를 찾을 수 없는 것은 맨 위로.
 * depth는 맨 위가 0
 */
export function flatTree<T extends { id: string }>(
  items: readonly T[],
  parentOf: (item: T) => string | null,
): { item: T; depth: number }[] {
  const ids = new Set(items.map((i) => i.id));
  const out: { item: T; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (parent: string | null, depth: number) => {
    for (const item of items) {
      const up = parentOf(item);
      const top = up === null || !ids.has(up);
      if ((parent === null ? !top : up !== parent) || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({ item, depth });
      visit(item.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** 구독 사용률의 창 */
export const WINDOW_LABELS: Record<string, string> = { five_hour: '5시간', seven_day: '7일' };

/** 쉬는 에이전트의 표시. 쉬는지는 서버가 정하고, 여기서는 왜인지만 고른다 */
export function holdLabel(agent: UsageAgent | undefined): string | null {
  if (!agent?.holding) return null;
  const tokensFull = agent.fiveHourLimit !== null && agent.fiveHourTokens >= agent.fiveHourLimit;
  return `쉬는 중 · ${tokensFull ? '5시간 한도' : '구독 사용률'}`;
}

/** 시각 (오늘이 아니면 날짜까지) */
export function when(iso: string): string {
  const at = new Date(iso);
  const today = at.toDateString() === new Date().toDateString();
  return at.toLocaleString(
    'ko-KR',
    today
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
  );
}

/** 실행 로그의 시:분 */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** 토큰 수. 1만이 넘으면 만 단위로 */
export function tokens(n: number): string {
  if (n < 10_000) return n.toLocaleString('ko-KR');
  const man = n / 10_000;
  return `${(Number.isInteger(man) ? man : Math.round(man * 10) / 10).toLocaleString('ko-KR')}만`;
}
