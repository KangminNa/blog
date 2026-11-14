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
/** browser-tabs 패키지: 에이전트가 발행 직전에 멈추고 올리는 결재. 서버는 실행하지 않고 주인이 직접 발행한다 */
export const PUBLISH_SITE = 'browser.site.publish';
/** code-github 패키지의 PR 머지 결재 (주인이 GitHub에서 머지한 뒤 승인) */
export const MERGE_PULL = 'code.pr.merge';

/** 목표 실행의 결재: 다음 회차로 갈지, 목표 실행을 완료로 닫을지 (서버의 Approval.GOAL_*) */
export const GOAL_CONTINUE = 'task.goal.continue';
export const GOAL_COMPLETE = 'task.goal.complete';
/** 목표 실행 결재의 대상 종류 (서버의 Approval.GOAL_RUN) */
export const GOAL_RUN = 'goal_run';

/** 승인 버튼의 말이 다른 동작. 서버가 실행하지 않고 주인이 직접 하는 것과, 목표 실행의 다음 걸음 */
export const APPROVE_LABELS: Record<string, string> = {
  [PUBLISH_SITE]: '직접 발행했어요',
  [MERGE_PULL]: '머지했어요',
  [GOAL_CONTINUE]: '다음 회차로',
  [GOAL_COMPLETE]: '완료로 닫기',
};

export const ACTION_LABELS: Record<string, string> = {
  [PUBLISH_POST]: '글 공개',
  [PUBLISH_SITE]: '브라우저에서 발행',
  [MERGE_PULL]: 'PR 머지',
  [RAISE_LIMIT]: '한도 변경',
  [GOAL_CONTINUE]: '목표 실행 중간 결재',
  [GOAL_COMPLETE]: '목표 실행 최종 결재',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export const TARGET_LABELS: Record<string, string> = {
  post: '글',
  agent: '에이전트',
  browser_site: '사이트',
  pull_request: 'PR',
  [GOAL_RUN]: '목표 실행',
};

export const GOAL_RUN_STATUS: Record<string, string> = {
  running: '회차 진행 중',
  waiting: '결재 대기',
  done: '완료',
  stopped: '멈춤',
};

/** 결재를 올리는 때 (서버의 GoalRun.CHECKPOINTS) */
export const CHECKPOINTS: Record<string, string> = {
  every: '회차마다',
  milestone: '중요 단계마다',
  final: '끝에만',
};

export const EVENT_KINDS: Record<string, string> = {
  read: '읽기',
  write: '쓰기',
  result: '완료',
  error: '오류',
};

export const TOOL_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };

/** 팀 템플릿이 다 돌려면 필요한 것 (서버의 AgentTeamRow.needs) */
export const NEEDS_LABELS: Record<string, string> = {
  'code-runner': '샌드박스 필요 (만들기 · 코드)',
  'code-github': 'code-github 플러그인 필요',
};

/** ISO 요일 (월 1 ~ 일 7)의 이름 */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
  6: '토',
  7: '일',
};

/** 스케줄 주기를 한 줄로: "매일 09:30 · 평일", "6시간마다", 꺼져 있으면 "꺼짐" */
export function scheduleLabel(schedule: {
  enabled: boolean;
  mode: string;
  atTime: string | null;
  weekdays: readonly number[];
  everyHours: number | null;
}): string {
  if (!schedule.enabled) return '꺼짐';
  if (schedule.mode === 'hourly') return `${schedule.everyHours}시간마다`;
  const days = schedule.weekdays.join(',');
  const which =
    days === '1,2,3,4,5,6,7'
      ? ''
      : days === '1,2,3,4,5'
        ? ' · 평일'
        : ` · ${schedule.weekdays.map((d) => WEEKDAY_LABELS[d]).join('')}`;
  return `매일 ${schedule.atTime}${which}`;
}

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

/** 결과물의 종류 (서버 OutputPolicy.KINDS) */
export const OUTPUT_KINDS: Record<string, string> = {
  document: '문서',
  slides: '슬라이드',
  sheet: '표',
  image: '이미지',
  video: '영상',
  other: '기타',
};

/** 미리 보기를 열 수 있는 형식 (서버가 앞부분으로 확인한 것만 inline을 준다: OutputPolicy.canInline) */
export const INLINE_MIMES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/webm',
];

/** 글자로 미리 볼 수 있는 형식 (내려받아 글자로만 보인다) */
export const TEXT_MIMES: readonly string[] = [
  'text/markdown',
  'text/plain',
  'text/csv',
  'text/tab-separated-values',
];

/** 바이트를 사람이 읽는 크기로 */
export function bytes(n: number): string {
  if (n < 1024) return `${n}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10}${units[unit]}`;
}
