// 작업·결재·에이전트의 화면 이름과 표시 형식

export const TASK_STATUS: Record<string, string> = {
  queued: '대기',
  running: '실행 중',
  waiting: '결재 대기',
  done: '완료',
  failed: '실패',
  cancelled: '취소',
};

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
